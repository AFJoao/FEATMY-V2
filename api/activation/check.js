/**
 * POST /api/activation/check
 *
 * Valida token de ativação server-side antes de mostrar o formulário de senha.
 * Não expõe dados sensíveis — retorna apenas nome e email do aluno.
 *
 * Respostas:
 *   200 { valid: true, name, email }
 *   400 Token ausente/malformado
 *   404 Token não encontrado
 *   409 Conta já ativada
 *   410 Token expirado ou já usado
 *   429 Rate limit
 *   500 Erro interno
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

// Rate limiting in-memory (por IP) — fallback quando Redis não disponível
// Para produção com tráfego alto, usar Upstash via ratelimit.js
const ipHits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const key = `check:${ip}`;
  const hits = (ipHits.get(key) || []).filter(t => now - t < 60_000);
  if (hits.length >= 20) return true; // 20 checks/min por IP
  hits.push(now);
  ipHits.set(key, hits);
  // GC periódico
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      if (v.every(t => now - t > 60_000)) ipHits.delete(k);
    }
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).end();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
  }

  const { token } = req.body || {};

  // Validação básica do token
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Token inválido.' });
  }

  try {
    // Buscar token no índice de ativações pendentes
    const snap = await db.collection('pendingActivations')
      .where('activationToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: 'Link de ativação inválido ou não encontrado.' });
    }

    const doc  = snap.docs[0];
    const data = doc.data();

    // Verificar status
    if (data.status === 'used') {
      return res.status(410).json({ error: 'Este link já foi utilizado. Faça login normalmente.' });
    }

    if (data.status === 'activating') {
      // Ativação em andamento em outro dispositivo
      return res.status(409).json({ error: 'Ativação em andamento. Aguarde alguns minutos.' });
    }

    if (data.status !== 'pending') {
      return res.status(410).json({ error: 'Link inválido.' });
    }

    // Verificar expiração
    const expiresAt = data.expiresAt?.toDate?.() || new Date(0);
    if (new Date() > expiresAt) {
      return res.status(410).json({ error: 'Link expirado. Solicite um novo ao seu personal trainer.' });
    }

    // Buscar dados do aluno
    const studentDoc = await db.collection('users').doc(data.studentDocId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Dados não encontrados. Contate seu personal trainer.' });
    }

    const student = studentDoc.data();

    // Verificar se conta já foi ativada de outra forma
    if (student.status === 'active' && student.authUid) {
      return res.status(409).json({ error: 'Conta já ativada. Faça login normalmente.' });
    }

    // Retornar apenas os dados necessários para o formulário
    return res.status(200).json({
      valid: true,
      name:  student.name  || '',
      email: student.email || '',
    });

  } catch (error) {
    console.error('[activation/check] Erro:', error.message);
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
};