/**
 * POST /api/webhook/abacatepay — v5
 *
 * CORREÇÃO 3.2 — Timeout para estado "processing".
 * Antes: se o handler crashava após reservar o slot, o documento ficava em
 * "processing" para sempre, bloqueando retries legítimos do webhook.
 * Agora: verifica idade do documento; se > 30s, considera expirado e permite
 * reprocessamento.
 *
 * Todas as correções v4 mantidas.
 */

const crypto = require('crypto');
const { admin, db } = require('../_lib/firebase-admin');

module.exports.config = {
  api: { bodyParser: false },
};

const isProd = process.env.NODE_ENV === 'production';

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

function validateHmac(rawBodyBuffer, signatureFromHeader, timestampHeader) {
  const secret = process.env.ABACATEPAY_WEBHOOK_SECRET;

  if (!secret) {
    if (isProd) {
      console.error('[webhook] CRÍTICO: ABACATEPAY_WEBHOOK_SECRET não configurada');
      return false;
    }
    console.warn('[webhook] AVISO: ABACATEPAY_WEBHOOK_SECRET não configurada — validação HMAC desativada em dev');
    return true;
  }

  try {
    let payload;
    if (timestampHeader) {
      payload = Buffer.concat([
        Buffer.from(String(timestampHeader) + '.'),
        rawBodyBuffer,
      ]);
    } else {
      payload = rawBodyBuffer;
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    const A = Buffer.from(expected);
    const B = Buffer.from(signatureFromHeader || '');
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

function isTimestampFresh(timestampHeader) {
  if (!timestampHeader) return true;
  const ts = parseInt(timestampHeader, 10);
  if (isNaN(ts)) return false;
  const ageSecs = Math.floor(Date.now() / 1000) - ts;
  return ageSecs >= -30 && ageSecs <= 300;
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

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // ── Camada 1: secret na query string ──────────────────────────────────────
  const webhookSecret = req.query.webhookSecret || '';
  if (webhookSecret !== process.env.ABACATEPAY_WEBHOOK_SECRET) {
    if (isProd || process.env.ABACATEPAY_WEBHOOK_SECRET) {
      await securityLog('WEBHOOK_INVALID_SECRET', { ip });
      console.warn('[webhook] Secret inválido rejeitado');
      return res.status(200).json({ received: true });
    }
  }

  // ── Camada 2: Proteção anti-replay via timestamp ───────────────────────────
  const timestampHeader = req.headers['x-webhook-timestamp'] || '';
  if (timestampHeader && !isTimestampFresh(timestampHeader)) {
    await securityLog('WEBHOOK_REPLAY_ATTEMPT', { ip, timestamp: timestampHeader });
    console.warn('[webhook] Timestamp inválido — possível replay attack');
    return res.status(200).json({ received: true });
  }

  // ── Camada 3: HMAC-SHA256 ──────────────────────────────────────────────────
  const signature = req.headers['x-webhook-signature'] || '';
  if (!validateHmac(rawBodyBuffer, signature, timestampHeader || null)) {
    await securityLog('WEBHOOK_INVALID_HMAC', {
      ip,
      signature: signature.slice(0, 20) + '...',
      hasTimestamp: !!timestampHeader,
    });
    console.warn('[webhook] HMAC inválido rejeitado');
    return res.status(200).json({ received: true });
  }

  // ── Parse do body ──────────────────────────────────────────────────────────
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

  // ── Idempotência com CORREÇÃO 3.2: timeout para estado "processing" ────────
  const processedRef = db.collection('processedWebhooks').doc(pixId);

  let alreadyProcessed = false;
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(processedRef);

      if (doc.exists) {
        const status = doc.data().status;

        if (status === 'done') {
          // Já processado com sucesso — ignorar
          alreadyProcessed = true;
          return;
        }

        if (status === 'processing') {
          // CORREÇÃO 3.2: verificar idade do lock
          const reservedAt = doc.data().reservedAt?.toMillis?.() || 0;
          const ageMs = Date.now() - reservedAt;
          const PROCESSING_TIMEOUT_MS = 30_000; // 30 segundos

          if (ageMs < PROCESSING_TIMEOUT_MS) {
            // Lock ainda válido — outro handler está processando
            alreadyProcessed = true;
            return;
          }

          // Lock expirado — o handler anterior crashou; permitir reprocessamento
          console.warn(`[webhook] Lock expirado (${ageMs}ms) para pixId=${pixId}, reprocessando`);
        }

        if (status === 'failed') {
          // Falha anterior — permitir retry
          console.log(`[webhook] Retry de webhook com falha anterior: pixId=${pixId}`);
        }
      }

      // Reservar o slot
      t.set(processedRef, {
        reservedAt: admin.firestore.FieldValue.serverTimestamp(),
        pixId,
        status:     'processing',
        ip,
      });
    });
  } catch (err) {
    console.error('[webhook] Erro na transação de idempotência:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }

  if (alreadyProcessed) {
    console.log('[webhook] Duplicado ignorado:', pixId);
    return res.status(200).json({ received: true, duplicate: true });
  }

  // ── Double-check via API AbacatePay ────────────────────────────────────────
  const confirmed       = await confirmPixViaAPI(pixId);
  const confirmedStatus = confirmed?.status || '';

  if (!['PAID', 'paid'].includes(confirmedStatus)) {
    await securityLog('WEBHOOK_UNCONFIRMED', { pixId, confirmedStatus, eventType });
    console.warn('[webhook] Pagamento não confirmado via API:', confirmedStatus);
    await processedRef.delete().catch(() => {});
    return res.status(200).json({ received: true });
  }

  // ── Buscar cobrança no Firestore ───────────────────────────────────────────
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
    await processedRef.delete().catch(() => {});
    return res.status(200).json({ received: true });
  }

  // ── Validação cruzada de valor ─────────────────────────────────────────────
  const confirmedAmount = confirmed?.amount;
  const expectedAmount  = billingData?.amountInCents;

  if (confirmedAmount !== undefined && expectedAmount !== undefined &&
      confirmedAmount !== expectedAmount) {
    await securityLog('WEBHOOK_AMOUNT_MISMATCH', {
      pixId, externalId,
      confirmedAmount, expectedAmount,
      personalId: billingData.personalId,
      planId:     billingData.planId,
    });
    console.error('[webhook] FRAUDE DETECTADA: Valor divergente:', { pixId, esperado: expectedAmount, confirmado: confirmedAmount });
    await processedRef.delete().catch(() => {});
    return res.status(200).json({ received: true });
  }

  const { personalId, planId } = billingData;

  // ── Processar pagamento ────────────────────────────────────────────────────
  try {
    await processedRef.update({
      status:       'done',
      processedAt:  admin.firestore.FieldValue.serverTimestamp(),
      billingDocId: billingDoc.id,
      personalId,
      pixId,
    });

    await billingDoc.ref.update({
      status:    'paid',
      gatewayId: pixId,
      paidAt:    admin.firestore.FieldValue.serverTimestamp(),
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

  } catch (error) {
    console.error('[webhook] Erro ao processar pagamento:', error.message);
    // CORREÇÃO 3.2: garantir que o status seja atualizado para 'failed'
    // Se isso também falhar, um retry futuro encontrará o documento em 'processing'
    // mas será tratado como expirado após 30s
    await processedRef.update({ status: 'failed', error: error.message })
      .catch(e => console.error('[webhook] Falha ao marcar como failed:', e.message));
    return res.status(500).json({ error: 'Erro ao processar pagamento' });
  }
}

module.exports = handler;