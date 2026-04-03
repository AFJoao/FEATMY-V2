/**
 * POST /api/billing/simulate-payment
 *
 * Só funciona com chaves _dev_ do AbacatePay.
 * Processa o pagamento localmente após simular na AbacatePay.
 *
 * Correções v2:
 * - Validação de ownership — personal só simula seus próprios billings
 * - CORS centralizado via helper (fail-closed em produção)
 * - Em dev, não bloqueia por processedWebhooks — permite re-simular
 */

const { applyCors } = require('../_lib/cors');
const admin = require('firebase-admin');

function initFirebase() {
  if (admin.apps.length) return;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`Variáveis faltando: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL ou FIREBASE_PRIVATE_KEY`);
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const PLANS = {
  starter: { maxStudents: 5,  durationDays: 30 },
  pro:     { maxStudents: 15, durationDays: 30 },
  elite:   { maxStudents: 40, durationDays: 30 },
};

async function verifyToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return await admin.auth().verifyIdToken(auth.slice(7));
  } catch {
    return null;
  }
}

function calcExpiry(planId) {
  const days = PLANS[planId]?.durationDays || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return admin.firestore.Timestamp.fromDate(d);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── CORS centralizado (fail-closed em produção) ───────────────
  try {
    applyCors(req, res, 'POST, OPTIONS');
  } catch (err) {
    console.error('[simulate-payment] CORS error:', err.message);
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  // Só em dev
  const apiKey = process.env.ABACATEPAY_API_KEY || '';
  if (!apiKey.includes('_dev_')) {
    return res.status(403).json({ error: 'Simulação disponível apenas em Dev Mode' });
  }

  try {
    initFirebase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const db = admin.firestore();

  // ── Autenticação ──────────────────────────────────────────────
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });

  const { gatewayPixId } = req.body || {};
  if (!gatewayPixId) return res.status(400).json({ error: 'gatewayPixId é obrigatório' });

  // ── 1. Tentar simular na AbacatePay (melhor esforço) ──────────
  let abacateOk = false;
  try {
    const abacateRes = await fetch(
      `https://api.abacatepay.com/v1/pixQrCode/simulate-payment?id=${gatewayPixId}`,
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

  // ── 2. Buscar billing pelo gatewayId ──────────────────────────
  const billingSnap = await db.collection('billings')
    .where('gatewayId', '==', gatewayPixId)
    .limit(1)
    .get();

  if (billingSnap.empty) {
    return res.status(404).json({
      error: 'Cobrança não encontrada. O billing pode ter sido criado sem gatewayId.',
    });
  }

  const billingDoc  = billingSnap.docs[0];
  const billingData = billingDoc.data();
  const { personalId, planId } = billingData;

  // ── 3. Validar ownership — CRÍTICO ────────────────────────────
  // Garante que o personal autenticado só pode simular pagamentos
  // de cobranças que ele mesmo gerou. Impede escalonamento horizontal.
  if (billingData.personalId !== decoded.uid) {
    console.warn(
      `[simulate-payment] Ownership violation: uid=${decoded.uid} ` +
      `tentou simular billing de personalId=${billingData.personalId}`
    );
    return res.status(403).json({ error: 'Acesso negado' });
  }

  // ── 4. Em dev, NÃO bloquear por processedWebhooks ─────────────
  // Em produção o webhook usa processedWebhooks para idempotência.
  // Aqui em dev queremos poder re-simular sem ter que limpar o Firestore.
  const processedRef = db.collection('processedWebhooks').doc(`dev_${gatewayPixId}`);

  // ── 5. Processar pagamento ────────────────────────────────────
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

  // Registrar com prefixo dev_ para não conflitar com webhooks reais
  await processedRef.set({
    processedAt:  admin.firestore.FieldValue.serverTimestamp(),
    billingDocId: billingDoc.id,
    personalId,
    pixId:        gatewayPixId,
    source:       'simulate-payment-dev',
  });

  console.log(`[simulate-payment] ✓ Ativado — personal=${personalId} plano=${planId}`);

  return res.status(200).json({
    success:   true,
    activated: true,
    abacateOk,
    planId,
    personalId,
  });
};