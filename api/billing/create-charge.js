/**
 * POST /api/billing/create-charge
 */

const admin = require('firebase-admin');
const { RateLimiterMemory } = require('rate-limiter-flexible');

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

// ── Rate limiter ───────────────────────────────────────────────
const rateLimiter = new RateLimiterMemory({ points: 5, duration: 60 });

// ── Planos ─────────────────────────────────────────────────────
const PLANS = {
  starter: { id: 'starter', name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { id: 'pro',     name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { id: 'elite',   name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

// ── Auth Firebase ──────────────────────────────────────────────
async function verifyToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return await admin.auth().verifyIdToken(auth.slice(7));
  } catch {
    return null;
  }
}

// ── Criar PIX (v1 — compatível com chaves abc_dev_...) ─────────
async function createPixQrCode({
  amount, externalId, personalId, planId,
  customerName, customerEmail, customerPhone, customerTaxId
}) {
  const apiKey = process.env.ABACATEPAY_API_KEY;
  if (!apiKey) throw new Error('ABACATEPAY_API_KEY não configurada');

  function formatCPF(raw) {
    const digits = (raw || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length !== 11) return digits;
    return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9,11)}`;
  }

  function formatPhone(raw) {
    const digits = (raw || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length === 11)
      return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7,11)}`;
    if (digits.length === 10)
      return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6,10)}`;
    return digits;
  }

  // v1: body plano, sem wrapper method/data
  const body = {
    amount,
    expiresIn:   1800,
    description: `Featym — Plano ${PLANS[planId]?.name}`,
    customer: {
      name:      customerName,
      email:     customerEmail,
      cellphone: formatPhone(customerPhone),
      taxId:     formatCPF(customerTaxId),
    },
    metadata: {
      personalId,
      planId,
      externalId,
    },
  };

  const res = await fetch('https://api.abacatepay.com/v1/pixQrCode/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`AbacatePay error ${res.status}: ${JSON.stringify(json)}`);
  }

  return json.data;
}

// ── Handler ────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Cache-Control', 'no-store');

  // 1. Auth
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });
  const uid = decoded.uid;

  // 2. Rate limit
  try {
    await rateLimiter.consume(uid);
  } catch {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
  }

  // 3. Plano
  const { planId } = req.body || {};
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Plano inválido' });

  // 4. Usuário
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || userDoc.data().userType !== 'personal') {
    return res.status(403).json({ error: 'Apenas personal trainers podem assinar' });
  }

  const userData = userDoc.data();

  // Dados do cliente com fallbacks seguros para dev
  const customerName  = userData.name  || 'Cliente Teste';
  const customerEmail = userData.email || 'teste@featym.com';
  const customerPhone = userData.phone || userData.cellphone || '11999999999';
  const customerTaxId = userData.cpf   || userData.taxId    || '033.020.720-23';

  // 5. Idempotência
  const now = new Date();
  const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const existingSnap = await db.collection('billings')
    .where('personalId', '==', uid)
    .where('billingPeriod', '==', billingPeriod)
    .where('status', 'in', ['pending', 'paid'])
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const ex = existingSnap.docs[0].data();
    return res.status(200).json({
      alreadyExists: true,
      billingId:    existingSnap.docs[0].id,
      gatewayPixId: ex.gatewayId,
      pixCopyPaste: ex.pixCopyPaste,
      pixBase64:    ex.pixBase64,
      status:       ex.status,
      amountBRL:    (plan.priceInCents / 100).toFixed(2).replace('.', ','),
      planName:     plan.name,
    });
  }

  // 6. externalId único
  const externalId = `featym_${uid}_${billingPeriod}_${Date.now()}`;

  // 7. Criar cobrança
  let pixData;
  try {
    pixData = await createPixQrCode({
      amount:         plan.priceInCents,
      externalId,
      personalId:     uid,
      planId,
      customerName,
      customerEmail,
      customerPhone,
      customerTaxId,
    });
  } catch (err) {
    console.error('[create-charge] Erro AbacatePay:', err.message);
    return res.status(502).json({ error: 'Erro ao gerar cobrança. Tente novamente.' });
  }

  // 8. Salvar no Firestore
  const billingRef  = db.collection('billings').doc();
  const billingData = {
    id:            billingRef.id,
    personalId:    uid,
    planId,
    planName:      plan.name,
    amountInCents: plan.priceInCents,
    status:        'pending',
    billingPeriod,
    externalId,
    gatewayId:     pixData.id || '',
    pixCopyPaste:  pixData.brCode       || '',
    pixBase64:     pixData.brCodeBase64 || '',
    expiresAt:     pixData.expiresAt
      ? admin.firestore.Timestamp.fromDate(new Date(pixData.expiresAt))
      : admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    paidAt:        null,
  };

  await billingRef.set(billingData);

  // 9. Resposta
  return res.status(201).json({
    billingId:    billingRef.id,
    gatewayPixId: pixData.id,
    pixCopyPaste: billingData.pixCopyPaste,
    pixBase64:    billingData.pixBase64,
    amountBRL:    (plan.priceInCents / 100).toFixed(2).replace('.', ','),
    planName:     plan.name,
    expiresAt:    pixData.expiresAt,
  });
};