/**
 * POST /api/webhook/abacatepay — v3
 *
 * CORREÇÃO v3 (VULN ATAQUE 2):
 * - Verificar confirmedAmount == billingData.amountInCents antes de ativar
 * - Previne upgrade gratuito de plano via externalId manipulado
 *
 * Mantidas todas as correções v2:
 * - bodyParser: false (rawBody para HMAC correto)
 * - 2 camadas: webhookSecret + HMAC-SHA256
 * - Idempotência via processedWebhooks
 * - Double-check via GET na API da AbacatePay
 */

const crypto = require('crypto');
const admin  = require('firebase-admin');

module.exports.config = {
  api: { bodyParser: false },
};

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

const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4' +
  'L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4' +
  'IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdi' +
  'DkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

const PLANS = {
  starter: { maxStudents: 5,  durationDays: 30 },
  pro:     { maxStudents: 15, durationDays: 30 },
  elite:   { maxStudents: 40, durationDays: 30 },
};

function getRawBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) { reject(new Error('Payload muito grande')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validateHmacSignature(rawBodyBuffer, signatureFromHeader) {
  try {
    const expected = crypto
      .createHmac('sha256', ABACATEPAY_PUBLIC_KEY)
      .update(rawBodyBuffer)
      .digest('base64');
    const A = Buffer.from(expected);
    const B = Buffer.from(signatureFromHeader || '');
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

async function confirmPixViaAPI(pixId) {
  try {
    const res = await fetch(
      `https://api.abacatepay.com/v1/pixQrCode/check?id=${pixId}`,
      { headers: { 'Authorization': `Bearer ${process.env.ABACATEPAY_API_KEY}` } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data || null;
  } catch {
    return null;
  }
}

function calcExpiry(planId) {
  const days = PLANS[planId]?.durationDays || 30;
  const d    = new Date();
  d.setDate(d.getDate() + days);
  return admin.firestore.Timestamp.fromDate(d);
}

async function securityLog(type, data) {
  try {
    await db.collection('securityLogs').add({
      type, data, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch { /* não crítico */ }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let rawBodyBuffer;
  try {
    rawBodyBuffer = await getRawBody(req);
  } catch (err) {
    console.error('[webhook] Erro ao ler body:', err.message);
    return res.status(400).json({ error: 'Body inválido' });
  }

  // Camada 1: secret na query string
  const webhookSecret = req.query.webhookSecret || '';
  if (webhookSecret !== process.env.ABACATEPAY_WEBHOOK_SECRET) {
    await securityLog('WEBHOOK_INVALID_SECRET', {
      ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown',
    });
    console.warn('[webhook] Secret inválido rejeitado');
    return res.status(200).json({ received: true });
  }

  // Camada 2: HMAC sobre raw bytes
  const signature = req.headers['x-webhook-signature'] || '';
  if (!validateHmacSignature(rawBodyBuffer, signature)) {
    await securityLog('WEBHOOK_INVALID_HMAC', {
      ip:        req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown',
      signature: signature.slice(0, 20) + '...',
    });
    console.warn('[webhook] HMAC inválido rejeitado');
    return res.status(200).json({ received: true });
  }

  let event;
  try {
    event = JSON.parse(rawBodyBuffer.toString('utf8'));
  } catch (err) {
    console.error('[webhook] JSON inválido:', err.message);
    return res.status(400).end();
  }

  const eventType = event?.event || '';
  const pixData   = event?.data?.transparent || event?.data?.checkout || {};
  const pixId     = pixData?.id || '';

  const isPaid = eventType === 'transparent.completed' || eventType === 'checkout.completed';
  if (!isPaid) {
    console.log('[webhook] Evento ignorado:', eventType);
    return res.status(200).json({ received: true });
  }

  if (!pixId) {
    console.error('[webhook] pixId ausente no payload');
    return res.status(200).json({ received: true });
  }

  // Idempotência
  const processedRef = db.collection('processedWebhooks').doc(pixId);
  const alreadyDone  = await processedRef.get();
  if (alreadyDone.exists) {
    console.log('[webhook] Duplicado ignorado:', pixId);
    return res.status(200).json({ received: true, duplicate: true });
  }

  // Double-check via API
  const confirmed       = await confirmPixViaAPI(pixId);
  const confirmedStatus = confirmed?.status || '';

  if (!['PAID', 'paid'].includes(confirmedStatus)) {
    await securityLog('WEBHOOK_UNCONFIRMED', { pixId, confirmedStatus, eventType });
    console.warn('[webhook] Pagamento não confirmado via API:', confirmedStatus);
    return res.status(200).json({ received: true });
  }

  // Buscar cobrança no Firestore
  const externalId = pixData?.externalId || event?.data?.metadata?.externalId || '';
  let billingDoc, billingData;

  if (externalId) {
    const snap = await db.collection('billings').where('externalId', '==', externalId).limit(1).get();
    if (!snap.empty) { billingDoc = snap.docs[0]; billingData = billingDoc.data(); }
  }

  if (!billingDoc) {
    const snap = await db.collection('billings').where('gatewayId', '==', pixId).limit(1).get();
    if (!snap.empty) { billingDoc = snap.docs[0]; billingData = billingDoc.data(); }
  }

  if (!billingDoc || !billingData) {
    await securityLog('WEBHOOK_BILLING_NOT_FOUND', { pixId, externalId });
    console.error('[webhook] Cobrança não encontrada para pixId:', pixId);
    return res.status(200).json({ received: true });
  }

  // CORREÇÃO VULN ATAQUE 2: Verificar se o valor confirmado bate com o billing
  // Previne upgrade de plano via externalId manipulado
  const confirmedAmount = confirmed?.amount;
  const expectedAmount  = billingData?.amountInCents;

  if (confirmedAmount !== undefined && expectedAmount !== undefined &&
      confirmedAmount !== expectedAmount) {
    await securityLog('WEBHOOK_AMOUNT_MISMATCH', {
      pixId,
      externalId,
      confirmedAmount,
      expectedAmount,
      personalId: billingData.personalId,
      planId: billingData.planId,
    });
    console.error('[webhook] FRAUDE DETECTADA: Valor divergente — pixId:', pixId,
      'esperado:', expectedAmount, 'confirmado:', confirmedAmount);
    // Retornar 200 para não revelar detecção ao atacante
    return res.status(200).json({ received: true });
  }

  const { personalId, planId } = billingData;

  // Marcar como processado (idempotência)
  await processedRef.set({
    processedAt:  admin.firestore.FieldValue.serverTimestamp(),
    billingDocId: billingDoc.id,
    personalId,
    pixId,
  });

  // Atualizar cobrança
  await billingDoc.ref.update({
    status:    'paid',
    gatewayId: pixId,
    paidAt:    admin.firestore.FieldValue.serverTimestamp(),
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
    await subRef.set({ ...subData, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  await db.collection('users').doc(personalId).update({
    subscriptionStatus:  'active',
    subscriptionPlan:    planId,
    subscriptionExpiry:  newExpiry,
    subscriptionUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[webhook] ✓ Assinatura ativada — personal=${personalId} plano=${planId}`);
  return res.status(200).json({ received: true, activated: true });
}

module.exports = handler;