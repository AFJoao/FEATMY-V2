/**
 * POST /api/billing/create-charge
 *
 * Correções v2:
 * - Idempotência só reutiliza se for o MESMO plano, status pending E QR ainda válido
 * - Upgrade/downgrade de plano sempre cria nova cobrança
 * - Renovação (paid → novo mês ou mesmo mês) sempre cria nova cobrança
 * - QR Code expirado → marca billing antigo como 'expired' e cria novo
 */

const { RateLimiterMemory } = require('rate-limiter-flexible');

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

const rateLimiter = new RateLimiterMemory({ points: 5, duration: 60 });

const PLANS = {
  starter: { id: 'starter', name: 'Starter', priceInCents: 990,  maxStudents: 5  },
  pro:     { id: 'pro',     name: 'Pro',     priceInCents: 1990, maxStudents: 15 },
  elite:   { id: 'elite',   name: 'Elite',   priceInCents: 4940, maxStudents: 40 },
};

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

// Verifica se um QR Code ainda está válido na AbacatePay
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
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  try {
    await rateLimiter.consume(uid);
  } catch {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
  }

  const { planId } = req.body || {};
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Plano inválido' });

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
  const customerName  = userData.name  || 'Cliente Teste';
  const customerEmail = userData.email || 'teste@featym.com';
  const customerPhone = userData.phone || userData.cellphone || '11999999999';
  const customerTaxId = userData.cpf   || userData.taxId    || '033.020.720-23';

  const now           = new Date();
  const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ── Idempotência inteligente ───────────────────────────────────
  // Só reutiliza se: mesmo plano + pending + QR ainda válido na AbacatePay
  // Não reutiliza se: plano diferente (upgrade), já pago (renovação), QR expirado
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
    // Não bloquear a criação se a verificação falhar
    console.warn('[create-charge] Idempotency check falhou (continuando):', err.message);
  }

  // ── Criar nova cobrança ──────────────────────────────────────
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
      gatewayId:     pixData.id          || '',
      pixCopyPaste:  pixData.brCode      || '',
      pixBase64:     pixData.brCodeBase64 || '',
      expiresAt:     pixData.expiresAt
        ? admin.firestore.Timestamp.fromDate(new Date(pixData.expiresAt))
        : admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
      paidAt:        null,
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