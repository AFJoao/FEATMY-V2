/**
 * GET /api/billing/subscription-status
 *
 * Retorna o status atual da assinatura do personal autenticado.
 * Toda lógica de status é calculada no backend (nunca no frontend).
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

const PLANS = {
  starter: { name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

// Dias de carência após vencimento
const GRACE_PERIOD_DAYS = 3;

async function verifyToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return await admin.auth().verifyIdToken(auth.slice(7));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Cache-Control', 'no-store');

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });

  const uid = decoded.uid;

  const subSnap = await db.collection('subscriptions').doc(uid).get();

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

  const msUntilExpiry  = expiresAt  - now;
  const msUntilGrace   = graceCutoff - now;
  const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

  let computedStatus;
  if (now < expiresAt)     computedStatus = 'active';
  else if (now < graceCutoff) computedStatus = 'grace_period';
  else                     computedStatus = 'expired';

  // Sincronizar no Firestore se status mudou
  if (sub.status !== computedStatus) {
    await subSnap.ref.update({
      status:    computedStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('users').doc(uid).update({
      subscriptionStatus: computedStatus,
    });
  }

  const isActive    = ['active', 'grace_period'].includes(computedStatus);
  const planConfig  = PLANS[sub.planId] || {};

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
