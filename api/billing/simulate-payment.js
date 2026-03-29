/**
 * POST /api/billing/simulate-payment
 * Apenas em Dev Mode — simula pagamento PIX chamando AbacatePay pelo backend.
 * O browser não pode chamar direto por causa de CORS.
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

async function verifyToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return await admin.auth().verifyIdToken(auth.slice(7));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Cache-Control', 'no-store');

  // Só funciona em dev
  const apiKey = process.env.ABACATEPAY_API_KEY || '';
  if (!apiKey.includes('_dev_')) {
    return res.status(403).json({ error: 'Simulação disponível apenas em Dev Mode' });
  }

  // Autenticar
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Não autenticado' });

  const { gatewayPixId } = req.body || {};
  if (!gatewayPixId) return res.status(400).json({ error: 'gatewayPixId é obrigatório' });

  // Chamar AbacatePay pelo backend (sem CORS)
  const res2 = await fetch(
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

  const json = await res2.json();

  if (!res2.ok || json.success === false) {
    console.error('[simulate-payment] Erro:', json);
    return res.status(502).json({ error: json.error || 'Erro ao simular pagamento' });
  }

  return res.status(200).json({ success: true, data: json.data });
};