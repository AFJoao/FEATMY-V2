/**
 * POST /api/billing/simulate-payment
 *
 * Só funciona com chaves _dev_ do AbacatePay.
 * Após simular na AbacatePay, processa o pagamento localmente
 * (igual ao webhook faria), para que o polling do frontend detecte.
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

  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Cache-Control', 'no-store');

  // Só em dev
  const apiKey = process.env.ABACATEPAY_API_KEY || '';
  if (!apiKey.includes('_dev_')) {
    return res.status(403).json({ error: 'Simulação disponível apenas em Dev Mode' });
  }

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });

  const { gatewayPixId } = req.body || {};
  if (!gatewayPixId) return res.status(400).json({ error: 'gatewayPixId é obrigatório' });

  // ── 1. Chamar AbacatePay para simular ────────────────────────
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
      console.warn('[simulate-payment] AbacatePay retornou erro:', abacateJson);
      // Continua mesmo assim — processamos localmente
    } else {
      abacateOk = true;
      console.log('[simulate-payment] AbacatePay simulação OK');
    }
  } catch (e) {
    console.warn('[simulate-payment] Erro ao chamar AbacatePay (continuando local):', e.message);
  }

  // ── 2. Processar pagamento localmente (idempotente) ──────────
  // Buscar billing pelo gatewayId
  const billingSnap = await db.collection('billings')
    .where('gatewayId', '==', gatewayPixId)
    .limit(1)
    .get();

  if (billingSnap.empty) {
    return res.status(404).json({ error: 'Cobrança não encontrada para este pixId' });
  }

  const billingDoc  = billingSnap.docs[0];
  const billingData = billingDoc.data();
  const { personalId, planId } = billingData;

  // Idempotência: já processado?
  const processedRef = db.collection('processedWebhooks').doc(gatewayPixId);
  const alreadyDone  = await processedRef.get();

  if (alreadyDone.exists) {
    console.log('[simulate-payment] Pagamento já processado anteriormente');
    return res.status(200).json({ success: true, alreadyProcessed: true });
  }

  // Marcar como processado
  await processedRef.set({
    processedAt:  admin.firestore.FieldValue.serverTimestamp(),
    billingDocId: billingDoc.id,
    personalId,
    pixId:        gatewayPixId,
    source:       'simulate-payment',
  });

  // Atualizar billing para "paid"
  await billingDoc.ref.update({
    status: 'paid',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Criar/atualizar assinatura
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

  // Atualizar doc do personal
  await db.collection('users').doc(personalId).update({
    subscriptionStatus:  'active',
    subscriptionPlan:    planId,
    subscriptionExpiry:  newExpiry,
    subscriptionUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[simulate-payment] ✓ Assinatura ativada — personal=${personalId} plano=${planId}`);

  return res.status(200).json({
    success:      true,
    activated:    true,
    abacateOk,    // informa se a chamada à AbacatePay também funcionou
    planId,
    personalId,
  });
};