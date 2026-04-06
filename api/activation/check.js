/**
 * POST /api/activation/check
 *
 * Verifica um token de ativação e retorna os dados necessários
 * para o aluno prosseguir com o primeiro acesso.
 *
 * POR QUE ESTE ENDPOINT EXISTE:
 *
 * A query `where('activationToken', '==', token)` no Firestore
 * não pode ser feita pelo cliente com `allow list: if false`.
 * Fazer `allow list: if true` exporia a coleção inteira.
 *
 * A solução correta é rodar a query no backend via Admin SDK,
 * que ignora as Security Rules e tem acesso total seguro.
 *
 * FLUXO:
 *   1. Aluno acessa /#/primeiro-acesso?token=xxxx
 *   2. primeiro-acesso.html faz POST /api/activation/check { token }
 *   3. Este endpoint valida o token e retorna { name, email, studentDocId }
 *   4. O cliente usa esses dados para criar a conta Auth + ativar
 *
 * SEGURANÇA:
 *   - Sem token válido: 404 sem revelar se existe ou não
 *   - Token expirado: 410 Gone
 *   - Token já usado: 409 Conflict
 *   - Rate limiting: 10 req/min por IP (sem UID pois usuário não está logado)
 */

const { logger }        = require('../_lib/logger');
const { checkRateLimit, getClientIp } = require('../_lib/ratelimit');

let _admin = null;
let _db    = null;

function getAdmin() {
  if (_admin) return _admin;

  const admin = require('firebase-admin');

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Variáveis de ambiente Firebase não configuradas');
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

module.exports = async function handler(req, res) {
  // Apenas POST
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  res.setHeader('Cache-Control', 'no-store');

  // CORS — aceita apenas a origem configurada
  const origin = req.headers.origin || '';
  const allowed = (process.env.APP_URL || '').split(',').map(s => s.trim());
  if (allowed.length > 0 && !allowed.includes(origin)) {
    return res.status(403).json({ error: 'Origin não permitida' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Rate limiting por IP (usuário não está logado ainda)
  const ip = getClientIp(req);
  try {
    const { limited, reset } = await checkRateLimit(`activation:ip:${ip}`, 'auth');
    if (limited) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      logger.warn('activation-check', 'Rate limit atingido', { ip });
      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde antes de tentar novamente.',
        retryAfterSeconds: retryAfter,
      });
    }
  } catch (err) {
    // Em produção sem Redis: fail-closed
    if (process.env.NODE_ENV === 'production') {
      logger.error('activation-check', 'Rate limit indisponível em produção', { error: err.message });
      return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }
    // Dev: continua sem rate limit
  }

  // Validar input
  const { token } = req.body || {};

  if (!token || typeof token !== 'string' || token.length < 32) {
    return res.status(400).json({ error: 'Token inválido' });
  }

  // Sanitizar token — apenas hex lowercase
  const cleanToken = token.replace(/[^a-f0-9]/g, '');
  if (cleanToken.length !== 64) {
    return res.status(400).json({ error: 'Token inválido' });
  }

  let admin, db;
  try {
    admin = getAdmin();
    db    = _db;
  } catch (err) {
    logger.error('activation-check', 'Firebase init error', { error: err.message });
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  try {
    // Query via Admin SDK — ignora Security Rules
    // O token de 64 chars é o segredo; sem ele, não há como encontrar o doc
    const snap = await db.collection('pendingActivations')
      .where('activationToken', '==', cleanToken)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snap.empty) {
      // Não revelar se o token existiu ou não — sempre 404
      logger.warn('activation-check', 'Token não encontrado', { ip, tokenPrefix: cleanToken.slice(0, 8) });
      return res.status(404).json({ error: 'Link de ativação inválido ou já utilizado.' });
    }

    const activationDoc  = snap.docs[0];
    const activationData = activationDoc.data();

    // Verificar expiração
    if (activationData.expiresAt) {
      const expiresAt = activationData.expiresAt.toDate
        ? activationData.expiresAt.toDate()
        : new Date(activationData.expiresAt.seconds * 1000);

      if (new Date() > expiresAt) {
        logger.warn('activation-check', 'Token expirado', { ip, tokenPrefix: cleanToken.slice(0, 8) });
        return res.status(410).json({
          error: 'Link de ativação expirado. Solicite um novo link ao seu personal trainer.',
          expired: true,
        });
      }
    }

    // Buscar doc do aluno
    const studentDoc = await db.collection('users').doc(activationData.studentDocId).get();

    if (!studentDoc.exists) {
      logger.warn('activation-check', 'Doc do aluno não encontrado', { studentDocId: activationData.studentDocId });
      return res.status(404).json({ error: 'Conta não encontrada. Entre em contato com seu personal trainer.' });
    }

    const studentData = studentDoc.data();

    if (studentData.status !== 'pending' && studentData.status !== 'activating') {
      return res.status(409).json({
        error: 'Esta conta já foi ativada. Faça login normalmente.',
        alreadyActive: true,
      });
    }

    // Retornar apenas o necessário — não expor dados sensíveis desnecessários
    return res.status(200).json({
      valid:        true,
      name:         studentData.name,
      email:        studentData.email,
      studentDocId: activationData.studentDocId,
      emailKey:     activationDoc.id,
    });

  } catch (err) {
    logger.error('activation-check', 'Erro ao verificar token', { error: err.message });
    return res.status(500).json({ error: 'Erro ao verificar link de ativação.' });
  }
};