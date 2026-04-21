/**
 * POST /api/billing/simulate-payment
 *
 * CORREÇÃO 3.9  — verifyToken migrado para _lib/auth.js centralizado.
 * CORREÇÃO 3.4  — validateContentType adicionado.
 * CORREÇÃO 3.10 — Firebase Admin via _lib/firebase-admin.js centralizado.
 *
 * Todas as correções v4 mantidas (bloqueio em produção, ownership check, etc.)
 */

const { applyCors }           = require('../_lib/cors');
const { checkRateLimitDual }  = require('../_lib/ratelimit');
const { logger }              = require('../_lib/logger');
const { verifyToken }         = require('../_lib/auth');
const { validateContentType } = require('../_lib/validateContentType');
const { admin, db }           = require('../_lib/firebase-admin');

const PLANS = {
  starter: { maxStudents: 5,  durationDays: 30 },
  pro:     { maxStudents: 15, durationDays: 30 },
  elite:   { maxStudents: 40, durationDays: 30 },
};

function calcExpiry(planId) {
  const days = PLANS[planId]?.durationDays || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return admin.firestore.Timestamp.fromDate(d);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── SECURITY: Bloquear em produção ────────────────────────────────────────
  const isProd   = process.env.NODE_ENV === 'production';
  const apiKey   = process.env.ABACATEPAY_API_KEY || '';
  const isDevKey = apiKey.includes('_dev_');

  if (isProd) {
    logger.security('simulate-payment', 'Tentativa de simulação em produção bloqueada');
    return res.status(403).json({ error: 'Endpoint não disponível em produção' });
  }

  if (!isDevKey) {
    return res.status(403).json({ error: 'Simulação disponível apenas com chave Dev Mode do AbacatePay' });
  }

  // ── CORS ──────────────────────────────────────────────────────────────────
  try {
    applyCors(req, res, 'POST, OPTIONS');
  } catch (err) {
    logger.security('simulate-payment', 'CORS bloqueado', { error: err.message });
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  // ── CORREÇÃO 3.4: Content-Type validation ─────────────────────────────────
  if (!validateContentType(req, res)) return;

  // ── CORREÇÃO 3.9: verifyToken centralizado ────────────────────────────────
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });

  const uid = decoded.uid;

  // ── Rate limiting ─────────────────────────────────────────────────────────
  try {
    const { limited, reset, reason } = await checkRateLimitDual(req, uid, 'billing');
    if (limited) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      logger.warn('simulate-payment', 'Rate limit atingido', { uid, reason });
      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde antes de tentar novamente.',
        retryAfterSeconds: retryAfter,
      });
    }
  } catch (err) {
    console.warn('[simulate-payment] Rate limit indisponível em dev:', err.message);
  }

  const { gatewayPixId } = req.body || {};
  if (!gatewayPixId || typeof gatewayPixId !== 'string' || gatewayPixId.length > 200) {
    return res.status(400).json({ error: 'gatewayPixId é obrigatório e deve ser uma string válida' });
  }

  // ── 1. Tentar simular na AbacatePay ───────────────────────────────────────
  let abacateOk = false;
  try {
    const abacateRes = await fetch(
      `https://api.abacatepay.com/v1/pixQrCode/simulate-payment?id=${encodeURIComponent(gatewayPixId)}`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ metadata: {} }),
      }
    );
    const abacateJson = await abacateRes.json();

    if (!abacateRes.ok || abacateJson.success === false) {
      console.warn('[simulate-payment] AbacatePay aviso (continuando local):', abacateJson.error);
    } else {
      abacateOk = true;
      console.log('[simulate-payment] AbacatePay simulação OK');
    }
  } catch (e) {
    console.warn('[simulate-payment] Erro ao chamar AbacatePay (continuando local):', e.message);
  }

  // ── 2. Buscar billing pelo gatewayId ──────────────────────────────────────
  const billingSnap = await db.collection('billings')
    .where('gatewayId', '==', gatewayPixId)
    .limit(1)
    .get();

  if (billingSnap.empty) {
    return res.status(404).json({ error: 'Cobrança não encontrada.' });
  }

  const billingDoc  = billingSnap.docs[0];
  const billingData = billingDoc.data();

  // ── 3. Validar ownership ──────────────────────────────────────────────────
  if (billingData.personalId !== decoded.uid) {
    logger.security('simulate-payment', 'Ownership violation', {
      uid:               decoded.uid,
      billingPersonalId: billingData.personalId,
      gatewayPixId,
    });
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const { personalId, planId } = billingData;

  // ── 4. Processar pagamento ────────────────────────────────────────────────
  const processedRef = db.collection('processedWebhooks').doc(`dev_${gatewayPixId}`);

  await billingDoc.ref.update({
    status: 'paid',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const planConfig = PLANS[planId] || PLANS.starter;
  const newExpiry  = calcExpiry(planId);
  const subRef     = db.collection('subscriptions').doc(personalId);
  const subSnap    = await subRef.get();

  const subData = {
    personalId,
    planId,
    maxStudents:   planConfig.maxStudents,
    status:        'active',
    lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt:     newExpiry,
    updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
  };

  if (subSnap.exists) {
    await subRef.update(subData);
  } else {
    await subRef.set({
      ...subData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await db.collection('users').doc(personalId).update({
    subscriptionStatus:  'active',
    subscriptionPlan:    planId,
    subscriptionExpiry:  newExpiry,
    subscriptionUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });

  await processedRef.set({
    processedAt:  admin.firestore.FieldValue.serverTimestamp(),
    billingDocId: billingDoc.id,
    personalId,
    pixId:        gatewayPixId,
    source:       'simulate-payment-dev',
  });

  logger.info('simulate-payment', 'Ativado em dev', { personalId, planId });

  return res.status(200).json({
    success:   true,
    activated: true,
    abacateOk,
    planId,
    personalId,
  });
};