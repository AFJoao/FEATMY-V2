/**
 * POST /api/activation/check
 *
 * CORREÇÃO 1.6 — CORS adicionado (estava ausente).
 * CORREÇÃO 1.7 — Rate limiting via Upstash Redis (checkRateLimitDual).
 *                O rate limiting in-memory anterior era ineficaz em serverless
 *                pois cada instância Vercel tem seu próprio Map.
 */

const { applyCors }          = require('../_lib/cors');
const { checkRateLimitDual } = require('../_lib/ratelimit');
const { admin, db }          = require('../_lib/firebase-admin');

module.exports = async function handler(req, res) {
  // ── CORREÇÃO 1.6: CORS ────────────────────────────────────────────────────
  try {
    applyCors(req, res, 'POST, OPTIONS');
  } catch (err) {
    return res.status(403).json({ error: 'Origin não permitida' });
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // ── CORREÇÃO 1.7: Rate limiting distribuído via Upstash ───────────────────
  try {
    const { limited, reset } = await checkRateLimitDual(req, null, 'auth');
    if (limited) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
    }
  } catch (err) {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      console.error('[activation/check] Rate limit error em produção:', err.message);
      return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }
    // Dev sem Redis: continuar
    console.warn('[activation/check] Rate limit indisponível em dev:', err.message);
  }

  const { token } = req.body || {};

  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Token inválido.' });
  }

  try {
    const snap = await db.collection('pendingActivations')
      .where('activationToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: 'Link de ativação inválido ou não encontrado.' });
    }

    const doc  = snap.docs[0];
    const data = doc.data();

    if (data.status === 'used') {
      return res.status(410).json({ error: 'Este link já foi utilizado. Faça login normalmente.' });
    }

    if (data.status === 'activating') {
      return res.status(409).json({ error: 'Ativação em andamento. Aguarde alguns minutos.' });
    }

    if (data.status !== 'pending') {
      return res.status(410).json({ error: 'Link inválido.' });
    }

    const expiresAt = data.expiresAt?.toDate?.() || new Date(0);
    if (new Date() > expiresAt) {
      return res.status(410).json({ error: 'Link expirado. Solicite um novo ao seu personal trainer.' });
    }

    const studentDoc = await db.collection('users').doc(data.studentDocId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Dados não encontrados. Contate seu personal trainer.' });
    }

    const student = studentDoc.data();

    if (student.status === 'active' && student.authUid) {
      return res.status(409).json({ error: 'Conta já ativada. Faça login normalmente.' });
    }

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