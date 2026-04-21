/**
 * GET /api/billing/subscription-status
 *
 * CORREÇÃO 3.9  — verifyToken migrado para _lib/auth.js centralizado.
 * CORREÇÃO 3.10 — Firebase Admin via _lib/firebase-admin.js centralizado.
 */

const { applyCors }    = require('../_lib/cors');
const { verifyToken }  = require('../_lib/auth');
const { admin, db }    = require('../_lib/firebase-admin');

const PLANS = {
  starter: { name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

const GRACE_PERIOD_DAYS = 3;

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  try {
    applyCors(req, res, 'GET, OPTIONS');
  } catch (err) {
    console.error('[subscription-status] CORS error:', err.message);
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  // ── CORREÇÃO 3.9: verifyToken centralizado ────────────────────────────────
  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const uid = decoded.uid;

  // ── Buscar assinatura ─────────────────────────────────────────────────────
  let subSnap;
  try {
    subSnap = await db.collection('subscriptions').doc(uid).get();
  } catch (err) {
    console.error('[subscription-status] Firestore error:', err.message);
    return res.status(500).json({ error: 'Erro ao consultar banco de dados' });
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

  // ── Sincronizar se mudou ──────────────────────────────────────────────────
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