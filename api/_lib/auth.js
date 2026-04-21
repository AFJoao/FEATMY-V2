/**
 * api/_lib/auth.js
 *
 * CORREÇÃO 3.9 — verifyToken centralizado.
 * Antes: cada endpoint tinha sua própria implementação com assinaturas diferentes.
 * CORREÇÃO 6.4 — verifyToken agora valida email_verified opcionalmente.
 */

const { admin } = require('./firebase-admin');

/**
 * Verifica o token Bearer do request.
 *
 * @param {object} req
 * @param {object} [options]
 * @param {boolean} [options.requireEmailVerified=false] — se true, rejeita tokens de emails não verificados
 * @returns {object|null} decoded token ou null se inválido
 */
async function verifyToken(req, { requireEmailVerified = false } = {}) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));

    if (requireEmailVerified && decoded.email_verified === false) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

module.exports = { verifyToken };