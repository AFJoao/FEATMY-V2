/**
 * api/_lib/validateContentType.js
 *
 * CORREÇÃO 3.4 — Content-Type validation middleware.
 * Previne ataques CSRF via form submission (application/x-www-form-urlencoded).
 * Browsers enviam POST com esse content-type sem preflight CORS.
 */

/**
 * Valida que o Content-Type do request é application/json.
 * Retorna false e responde 415 se inválido.
 *
 * @param {object} req
 * @param {object} res
 * @returns {boolean} true se válido, false se rejeitado
 */
function validateContentType(req, res) {
  // GET, OPTIONS e DELETE não têm body — pular validação
  if (['GET', 'OPTIONS', 'DELETE'].includes(req.method)) return true;

  const ct = (req.headers['content-type'] || '').split(';')[0].trim();
  if (ct !== 'application/json') {
    res.status(415).json({ error: 'Content-Type deve ser application/json' });
    return false;
  }
  return true;
}

module.exports = { validateContentType };