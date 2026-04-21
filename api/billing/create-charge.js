/**
 * POST /api/billing/create-charge
 *
 * Correções v5:
 * CORREÇÃO 1.2  — Schema validation com Zod (.strict() rejeita campos extras)
 * CORREÇÃO 3.4  — Content-Type validation
 * CORREÇÃO 3.8  — Quota de billings pendentes por personal (máx 3)
 * CORREÇÃO 3.9  — verifyToken centralizado via _lib/auth.js
 * CORREÇÃO 3.10 — Firebase Admin centralizado via _lib/firebase-admin.js
 */

const { applyCors }            = require('../_lib/cors');
const { checkRateLimitDual }   = require('../_lib/ratelimit');
const { verifyToken }          = require('../_lib/auth');
const { validateContentType }  = require('../_lib/validateContentType');
const { admin, db }            = require('../_lib/firebase-admin');

// ── Zod schema (CORREÇÃO 1.2) ─────────────────────────────────────────────
let z;
try {
  ({ z } = require('zod'));
} catch {
  z = null;
}

const PLANS = {
  starter: { id: 'starter', name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { id: 'pro',     name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { id: 'elite',   name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

// ── Validação de CPF (dígitos verificadores) ──────────────────────────────
function validateCPF(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const calc = (factor) => {
    let sum = 0;
    for (let i = 0; i < factor - 1; i++) sum += parseInt(digits[i]) * (factor - i);
    const remainder = (sum * 10) % 11;
    return remainder === 10 || remainder === 11 ? 0 : remainder;
  };
  return calc(10) === parseInt(digits[9]) && calc(11) === parseInt(digits[10]);
}

function validatePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

function formatCPF(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9,11)}`;
}

function formatPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length === 11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7,11)}`;
  if (digits.length === 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6,10)}`;
  return digits;
}

async function createPixQrCode({
  amount, externalId, personalId, planId,
  customerName, customerEmail, customerPhone, customerTaxId,
}) {
  const apiKey = process.env.ABACATEPAY_API_KEY;
  if (!apiKey) throw new Error('ABACATEPAY_API_KEY não configurada');

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
    metadata: { personalId, planId, externalId },
  };

  const fetchRes = await fetch('https://api.abacatepay.com/v1/pixQrCode/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await fetchRes.json();

  if (!fetchRes.ok || !json.success) {
    throw new Error(`AbacatePay error ${fetchRes.status}: ${JSON.stringify(json)}`);
  }

  return json.data;
}

async function isPixStillValid(gatewayId) {
  if (!gatewayId) return false;
  try {
    const checkRes = await fetch(
      `https://api.abacatepay.com/v1/pixQrCode/check?id=${gatewayId}`,
      { headers: { 'Authorization': `Bearer ${process.env.ABACATEPAY_API_KEY}` } }
    );
    const checkJson = await checkRes.json();
    return checkRes.ok && checkJson?.data?.status === 'PENDING';
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  try {
    applyCors(req, res, 'POST, OPTIONS');
  } catch (err) {
    console.error('[create-charge] CORS error:', err.message);
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // ── CORREÇÃO 3.4: Content-Type validation ─────────────────────────────────
  if (!validateContentType(req, res)) return;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });

  const uid = decoded.uid;

  // ── Rate limiting ─────────────────────────────────────────────────────────
  try {
    const { limited, reset, reason } = await checkRateLimitDual(req, uid, 'billing');
    if (limited) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      console.warn(`[create-charge] Rate limit atingido — uid=${uid} reason=${reason}`);
      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde antes de tentar novamente.',
        retryAfterSeconds: retryAfter,
      });
    }
  } catch (err) {
    console.error('[create-charge] Rate limit error:', err.message);
    return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
  }

  // ── CORREÇÃO 1.2: Schema validation com Zod ───────────────────────────────
  const { planId, cpf, phone } = req.body || {};

  if (z) {
    const schema = z.object({
      planId: z.enum(['starter', 'pro', 'elite']),
      cpf:    z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos'),
      phone:  z.string().regex(/^\d{10,11}$/, 'Telefone deve ter 10 ou 11 dígitos'),
    }).strict(); // .strict() rejeita campos extras

    const parsed = schema.safeParse({
      planId,
      cpf:   (cpf   || '').replace(/\D/g, ''),
      phone: (phone || '').replace(/\D/g, ''),
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Dados inválidos.',
        details: parsed.error.errors.map(e => e.message),
      });
    }
  } else {
    // Fallback manual se Zod não estiver instalado
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Plano inválido' });
    if (!cpf || !validateCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.', field: 'cpf' });
    if (!phone || !validatePhone(phone)) return res.status(400).json({ error: 'Telefone inválido.', field: 'phone' });
  }

  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Plano inválido' });

  // Validações adicionais de CPF/telefone
  if (!validateCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.', field: 'cpf' });
  if (!validatePhone(phone)) return res.status(400).json({ error: 'Telefone inválido.', field: 'phone' });

  // ── Buscar dados do usuário ───────────────────────────────────────────────
  let userDoc;
  try {
    userDoc = await db.collection('users').doc(uid).get();
  } catch (err) {
    console.error('[create-charge] Firestore error:', err.message);
    return res.status(500).json({ error: 'Erro ao consultar banco de dados' });
  }

  if (!userDoc.exists || userDoc.data().userType !== 'personal') {
    return res.status(403).json({ error: 'Apenas personal trainers podem assinar' });
  }

  const userData      = userDoc.data();
  const customerName  = userData.name  || 'Cliente';
  const customerEmail = userData.email || '';
  const customerTaxId = cpf;
  const customerPhone = phone;

  const now           = new Date();
  const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ── CORREÇÃO 3.8: Quota de billings pendentes ─────────────────────────────
  try {
    const pendingSnap = await db.collection('billings')
      .where('personalId', '==', uid)
      .where('status', '==', 'pending')
      .get();

    if (pendingSnap.size >= 3) {
      return res.status(429).json({
        error: 'Muitas cobranças pendentes. Pague ou aguarde expiração das cobranças anteriores.',
      });
    }
  } catch (err) {
    console.warn('[create-charge] Quota check falhou (continuando):', err.message);
  }

  // ── Idempotência inteligente ──────────────────────────────────────────────
  try {
    const pendingSnap = await db.collection('billings')
      .where('personalId', '==', uid)
      .where('billingPeriod', '==', billingPeriod)
      .where('planId', '==', planId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!pendingSnap.empty) {
      const existingDoc  = pendingSnap.docs[0];
      const existingData = existingDoc.data();

      const valid = await isPixStillValid(existingData.gatewayId);

      if (valid) {
        console.log('[create-charge] Reutilizando cobrança pendente válida:', existingDoc.id);
        return res.status(200).json({
          alreadyExists: true,
          billingId:    existingDoc.id,
          gatewayPixId: existingData.gatewayId,
          pixCopyPaste: existingData.pixCopyPaste,
          pixBase64:    existingData.pixBase64,
          status:       existingData.status,
          amountBRL:    (plan.priceInCents / 100).toFixed(2).replace('.', ','),
          planName:     plan.name,
        });
      }

      console.log('[create-charge] QR Code expirado, criando novo para plano:', planId);
      await existingDoc.ref.update({ status: 'expired' });
    }
  } catch (err) {
    console.warn('[create-charge] Idempotency check falhou (continuando):', err.message);
  }

  // ── Criar nova cobrança ───────────────────────────────────────────────────
  const externalId = `featym_${uid}_${billingPeriod}_${planId}_${Date.now()}`;

  let pixData;
  try {
    pixData = await createPixQrCode({
      amount: plan.priceInCents,
      externalId,
      personalId:     uid,
      planId,
      customerName,
      customerEmail,
      customerPhone,
      customerTaxId,
    });
  } catch (err) {
    console.error('[create-charge] AbacatePay error:', err.message);
    return res.status(502).json({ error: 'Erro ao gerar cobrança. Tente novamente.' });
  }

  let billingRef;
  try {
    billingRef = db.collection('billings').doc();
    await billingRef.set({
      id:            billingRef.id,
      personalId:    uid,
      planId,
      planName:      plan.name,
      amountInCents: plan.priceInCents,
      status:        'pending',
      billingPeriod,
      externalId,
      gatewayId:     pixData.id           || '',
      pixCopyPaste:  pixData.brCode       || '',
      pixBase64:     pixData.brCodeBase64 || '',
      expiresAt:     pixData.expiresAt
        ? admin.firestore.Timestamp.fromDate(new Date(pixData.expiresAt))
        : admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
      paidAt:        null,
      customerName,
      customerEmail,
    });
  } catch (err) {
    console.error('[create-charge] Firestore save error:', err.message);
    return res.status(500).json({ error: 'Erro ao salvar cobrança' });
  }

  console.log(`[create-charge] ✓ Cobrança criada: ${billingRef.id} plano=${planId} uid=${uid}`);

  return res.status(201).json({
    billingId:    billingRef.id,
    gatewayPixId: pixData.id,
    pixCopyPaste: pixData.brCode       || '',
    pixBase64:    pixData.brCodeBase64 || '',
    amountBRL:    (plan.priceInCents / 100).toFixed(2).replace('.', ','),
    planName:     plan.name,
    expiresAt:    pixData.expiresAt,
  });
};