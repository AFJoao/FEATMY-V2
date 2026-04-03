/**
 * POST /api/billing/create-charge
 *
 * Correções v4:
 * - Rate limiting persistente via Upstash Redis (duplo: UID + IP)
 * - CORS centralizado via helper (fail-closed em produção)
 * - CPF e telefone recebidos no body (não salvos no Firestore)
 * - Validação de CPF (dígitos verificadores) e telefone no backend
 * - Idempotência inteligente por período de cobrança
 */

const { applyCors }          = require('../_lib/cors');
const { checkRateLimitDual } = require('../_lib/ratelimit');

let _admin = null;
let _db    = null;

function getAdmin() {
  if (_admin) return _admin;

  const admin = require('firebase-admin');

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Variáveis de ambiente faltando: ${[
        !projectId   && 'FIREBASE_PROJECT_ID',
        !clientEmail && 'FIREBASE_CLIENT_EMAIL',
        !privateKey  && 'FIREBASE_PRIVATE_KEY',
      ].filter(Boolean).join(', ')}`
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }

  _admin = admin;
  _db    = admin.firestore();
  return admin;
}

const PLANS = {
  starter: { id: 'starter', name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { id: 'pro',     name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { id: 'elite',   name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

// ── Validação de CPF (dígitos verificadores) ──────────────────────
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

// ── Validação de telefone brasileiro ─────────────────────────────
function validatePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

// ── Formatadores para a API da AbacatePay ────────────────────────
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

async function verifyToken(admin, req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    return await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return null;
  }
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

// ── Verifica se um QR Code ainda está válido na AbacatePay ───────
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
  // ── CORS centralizado (fail-closed em produção) ───────────────
  try {
    applyCors(req, res, 'POST, OPTIONS');
  } catch (err) {
    console.error('[create-charge] CORS error:', err.message);
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  let admin, db;
  try {
    admin = getAdmin();
    db    = _db;
  } catch (err) {
    console.error('[create-charge] Firebase init error:', err.message);
    return res.status(500).json({ error: 'Erro de configuração do servidor', detail: err.message });
  }

  const decoded = await verifyToken(admin, req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });

  const uid = decoded.uid;

  // ── Rate limiting duplo: por UID + por IP ─────────────────────
  // Protege contra abuso por usuário e bypass via múltiplas contas
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
    // Em produção: Redis indisponível → fail-closed (503)
    console.error('[create-charge] Rate limit error:', err.message);
    return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
  }

  const { planId, cpf, phone } = req.body || {};

  // ── Validar plano ─────────────────────────────────────────────
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Plano inválido' });

  // ── Validar CPF ───────────────────────────────────────────────
  if (!cpf || !validateCPF(cpf)) {
    return res.status(400).json({ error: 'CPF inválido.', field: 'cpf' });
  }

  // ── Validar telefone ──────────────────────────────────────────
  if (!phone || !validatePhone(phone)) {
    return res.status(400).json({
      error: 'Telefone inválido. Informe DDD + número (10 ou 11 dígitos).',
      field: 'phone',
    });
  }

  // ── Buscar dados do usuário ───────────────────────────────────
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

  // CPF e telefone vêm do body — não salvos, não lidos do Firestore
  const customerTaxId = cpf;
  const customerPhone = phone;

  const now           = new Date();
  const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ── Idempotência inteligente ──────────────────────────────────
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

      // QR expirou — invalidar e criar novo
      console.log('[create-charge] QR Code expirado, criando novo para plano:', planId);
      await existingDoc.ref.update({ status: 'expired' });
    }
  } catch (err) {
    console.warn('[create-charge] Idempotency check falhou (continuando):', err.message);
  }

  // ── Criar nova cobrança ───────────────────────────────────────
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

  // Salvar billing — CPF e telefone NÃO são salvos
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