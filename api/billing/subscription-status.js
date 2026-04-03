/**
 * GET /api/billing/subscription-status
 *
 * Correções v2:
 * - CORS centralizado via helper (fail-closed em produção)
 */

const { applyCors } = require('../_lib/cors');
const admin = require('firebase-admin');

// ── Inicialização segura do Firebase Admin ──────────────────────
function initFirebase() {
  if (admin.apps.length) return;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Variáveis de ambiente faltando: ${[
        !projectId   && 'FIREBASE_PROJECT_ID',
        !clientEmail && 'FIREBASE_CLIENT_EMAIL',
        !privateKey  && 'FIREBASE_PRIVATE_KEY',
      ].filter(Boolean).join(', ')}`
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const PLANS = {
  starter: { name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

const GRACE_PERIOD_DAYS = 3;

async function verifyToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    return await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  // ── CORS centralizado (fail-closed em produção) ───────────────
  try {
    applyCors(req, res, 'GET, OPTIONS');
  } catch (err) {
    console.error('[subscription-status] CORS error:', err.message);
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  // ── Inicializar Firebase ──────────────────────────────────────
  try {
    initFirebase();
  } catch (err) {
    console.error('[subscription-status] Firebase init error:', err.message);
    return res.status(500).json({
      error: 'Erro de configuração do servidor',
      detail: err.message,
    });
  }

  const db = admin.firestore();

  // ── Autenticar ────────────────────────────────────────────────
  let decoded;
  try {
    decoded = await verifyToken(req);
  } catch (err) {
    console.error('[subscription-status] Token verification error:', err.message);
    return res.status(401).json({ error: 'Erro ao verificar autenticação' });
  }

  if (!decoded) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const uid = decoded.uid;

  // ── Buscar assinatura ─────────────────────────────────────────
  let subSnap;
  try {
    subSnap = await db.collection('subscriptions').doc(uid).get();
  } catch (err) {
    console.error('[subscription-status] Firestore error:', err.message);
    return res.status(500).json({
      error: 'Erro ao consultar banco de dados',
      detail: err.message,
    });
  }

  if (!subSnap.exists) {
    return res.status(200).json({
      status:          'no_subscription',
      isActive:        false,
      daysUntilExpiry: null,
      plan:            null,
      maxStudents:     0,
      showWarning:     false,
      warningMessage:  null,
      warningLevel:    null,
    });
  }

  const sub = subSnap.data();
  const now = new Date();

  const expiresAt   = sub.expiresAt?.toDate?.() || new Date(0);
  const graceCutoff = new Date(expiresAt);
  graceCutoff.setDate(graceCutoff.getDate() + GRACE_PERIOD_DAYS);

  const msUntilExpiry   = expiresAt   - now;
  const msUntilGrace    = graceCutoff - now;
  const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

  let computedStatus;
  if (now < expiresAt)        computedStatus = 'active';
  else if (now < graceCutoff) computedStatus = 'grace_period';
  else                        computedStatus = 'expired';

  // ── Sincronizar se mudou ──────────────────────────────────────
  if (sub.status !== computedStatus) {
    try {
      await subSnap.ref.update({
        status:    computedStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('users').doc(uid).update({
        subscriptionStatus: computedStatus,
      });
    } catch (err) {
      console.warn('[subscription-status] Sync update failed (non-critical):', err.message);
    }
  }

  const isActive   = ['active', 'grace_period'].includes(computedStatus);
  const planConfig = PLANS[sub.planId] || {};

  let showWarning    = false;
  let warningMessage = null;
  let warningLevel   = null;

  if (computedStatus === 'expired') {
    showWarning    = true;
    warningLevel   = 'danger';
    warningMessage = 'Sua assinatura expirou. Renove para liberar o acesso dos seus alunos.';
  } else if (computedStatus === 'grace_period') {
    showWarning    = true;
    warningLevel   = 'danger';
    const daysLeft = Math.ceil(msUntilGrace / (1000 * 60 * 60 * 24));
    warningMessage = `Assinatura vencida! ${daysLeft} dia(s) de carência restante(s). Renove agora.`;
  } else if (daysUntilExpiry <= 7) {
    showWarning    = true;
    warningLevel   = daysUntilExpiry <= 3 ? 'warning' : 'info';
    warningMessage = `Sua assinatura vence em ${daysUntilExpiry} dia(s). Renove para não interromper o acesso dos alunos.`;
  }

  return res.status(200).json({
    status:          computedStatus,
    isActive,
    planId:          sub.planId,
    planName:        planConfig.name || sub.planId,
    maxStudents:     planConfig.maxStudents || sub.maxStudents || 0,
    daysUntilExpiry,
    expiresAt:       expiresAt.toISOString(),
    showWarning,
    warningMessage,
    warningLevel,
  });
};