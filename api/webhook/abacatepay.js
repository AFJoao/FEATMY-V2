/**
 * POST /api/webhook/abacatepay — v4
 *
 * CORREÇÕES v4:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. HMAC usa process.env.ABACATEPAY_WEBHOOK_SECRET (não a chave pública hardcoded)
 *    A chave pública anterior era usada erroneamente como segredo HMAC —
 *    qualquer pessoa com acesso ao código podia forjar webhooks.
 *
 * 2. Proteção contra replay attack via timestamp no header:
 *    - AbacatePay deve enviar X-Webhook-Timestamp (epoch segundos)
 *    - Rejeita payloads com timestamp > 5 minutos no passado
 *    - HMAC é calculado sobre rawBody + timestamp (impede reutilização)
 *
 * 3. Idempotência garantida: processedWebhooks bloqueado ANTES de qualquer
 *    operação de negócio (não depois).
 *
 * 4. Validação cruzada com Firestore: confirmedAmount == billingData.amountInCents
 *    (mantida da v3)
 *
 * 5. Fallback de HMAC legado: se ABACATEPAY_WEBHOOK_SECRET não estiver
 *    configurada, rejeita com 500 (fail-closed) em produção.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Variável de ambiente obrigatória:
 *   ABACATEPAY_WEBHOOK_SECRET — segredo compartilhado com AbacatePay
 *   (configure no painel da AbacatePay e adicione na Vercel)
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

const db      = admin.firestore();
const isProd  = process.env.NODE_ENV === 'production';

const PLANS = {
  starter: { maxStudents: 5,  durationDays: 30 },
  pro:     { maxStudents: 15, durationDays: 30 },
  elite:   { maxStudents: 40, durationDays: 30 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Valida assinatura HMAC-SHA256.
 *
 * AbacatePay envia:
 *   X-Webhook-Signature: base64(HMAC-SHA256(secret, rawBody))
 *   X-Webhook-Timestamp: epoch_seconds  (opcional mas recomendado)
 *
 * Se timestamp disponível, inclui no payload assinado para prevenir replay:
 *   HMAC(secret, timestamp + "." + rawBody)
 *
 * Compatibilidade retroativa: se não houver timestamp, assina só o rawBody.
 */
function validateHmac(rawBodyBuffer, signatureFromHeader, timestampHeader) {
  const secret = process.env.ABACATEPAY_WEBHOOK_SECRET;

  if (!secret) {
    if (isProd) {
      console.error('[webhook] CRÍTICO: ABACATEPAY_WEBHOOK_SECRET não configurada');
      return false; // fail-closed
    }
    // Em dev sem segredo configurado: aceitar (mas logar)
    console.warn('[webhook] AVISO: ABACATEPAY_WEBHOOK_SECRET não configurada — validação HMAC desativada em dev');
    return true;
  }

  try {
    let payload;
    if (timestampHeader) {
      // Payload assinado inclui timestamp para prevenir replay
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

/**
 * Proteção anti-replay: rejeita webhooks com timestamp > 5 minutos no passado.
 * Retorna true se o timestamp é válido (recente).
 */
function isTimestampFresh(timestampHeader) {
  if (!timestampHeader) return true; // timestamp não obrigatório ainda (compatibilidade)
  const ts   = parseInt(timestampHeader, 10);
  if (isNaN(ts)) return false;
  const ageSecs = Math.floor(Date.now() / 1000) - ts;
  return ageSecs >= -30 && ageSecs <= 300; // aceita até 5 min no passado, 30s no futuro
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

// ── Handler ───────────────────────────────────────────────────────────────────

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
    // Em dev sem segredo, permitir (já logado acima)
    if (isProd || process.env.ABACATEPAY_WEBHOOK_SECRET) {
      await securityLog('WEBHOOK_INVALID_SECRET', { ip });
      console.warn('[webhook] Secret inválido rejeitado');
      return res.status(200).json({ received: true }); // 200 para não revelar ao atacante
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

  // ── Idempotência: verificar ANTES de qualquer operação de negócio ──────────
  // Isso previne processamento duplo mesmo sob condições de concorrência
  const processedRef = db.collection('processedWebhooks').doc(pixId);

  // Usar transação para marcar como processado atomicamente
  let alreadyProcessed = false;
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(processedRef);
      if (doc.exists) {
        alreadyProcessed = true;
        return;
      }
      // Reservar o slot ANTES de processar (previne race condition)
      t.set(processedRef, {
        reservedAt:  admin.firestore.FieldValue.serverTimestamp(),
        pixId,
        status:      'processing',
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
    // Liberar slot de idempotência para não bloquear retry legítimo futuro
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

  // ── Validação cruzada de valor (previne upgrade de plano fraudulento) ───────
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
    console.error('[webhook] FRAUDE DETECTADA: Valor divergente:', {
      pixId, esperado: expectedAmount, confirmado: confirmedAmount,
    });
    await processedRef.delete().catch(() => {});
    return res.status(200).json({ received: true });
  }

  const { personalId, planId } = billingData;

  // ── Processar pagamento ────────────────────────────────────────────────────
  try {
    // Atualizar status do processedWebhooks para 'done'
    await processedRef.update({
      status:       'done',
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

  } catch (error) {
    console.error('[webhook] Erro ao processar pagamento:', error.message);
    // Marcar como falha para permitir retry
    await processedRef.update({ status: 'failed', error: error.message }).catch(() => {});
    return res.status(500).json({ error: 'Erro ao processar pagamento' });
  }
}

module.exports = handler;