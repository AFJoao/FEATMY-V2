/**
 * GET /api/billing/subscription-status
 *
 * Correções v3:
 * - Firebase Admin singleton robusto: usa try/catch em getApp() para
 *   evitar erros de "app/duplicate-app" em ambiente serverless onde
 *   múltiplas invocações simultâneas podem chamar initializeApp() ao
 *   mesmo tempo. Agora usa getApp() primeiro e só chama initializeApp()
 *   se o app realmente não existir ainda.
 * - Erro 500 em produção: melhor diagnóstico de variáveis de ambiente
 *   faltando com mensagem clara.
 * - CORS centralizado via helper (fail-closed em produção).
 */

const { applyCors } = require('../_lib/cors');

// ── Singleton robusto para ambiente serverless ──────────────────
// Em serverless, múltiplas invocações paralelas podem tentar
// inicializar o Firebase ao mesmo tempo. Usar getApp() + try/catch
// é a forma correta de evitar "app/duplicate-app".
function getFirebaseAdmin() {
  const admin = require('firebase-admin');

  try {
    // Tentar obter app já existente primeiro
    return { admin, db: admin.firestore() };
  } catch (_) {
    // App não existe ainda — inicializar
  }

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    const missing = [
      !projectId   && 'FIREBASE_PROJECT_ID',
      !clientEmail && 'FIREBASE_CLIENT_EMAIL',
      !privateKey  && 'FIREBASE_PRIVATE_KEY',
    ].filter(Boolean).join(', ');
    throw new Error(`Variáveis de ambiente faltando no servidor: ${missing}. Configure-as no painel da Vercel.`);
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  } catch (err) {
    // Se outro processo já inicializou entre o try acima e aqui (race),
    // getApp() agora vai funcionar
    if (err.code !== 'app/duplicate-app') throw err;
  }

  return { admin, db: admin.firestore() };
}

const PLANS = {
  starter: { name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

const GRACE_PERIOD_DAYS = 3;

async function verifyToken(admin, req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    return await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────
  try {
    applyCors(req, res, 'GET, OPTIONS');
  } catch (err) {
    console.error('[subscription-status] CORS error:', err.message);
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  // ── Firebase ──────────────────────────────────────────────────
  let admin, db;
  try {
    ({ admin, db } = getFirebaseAdmin());
  } catch (err) {
    console.error('[subscription-status] Firebase init error:', err.message);
    return res.status(500).json({
      error: 'Erro de configuração do servidor',
      detail: err.message,
    });
  }

  // ── Autenticar ────────────────────────────────────────────────
  const decoded = await verifyToken(admin, req);
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