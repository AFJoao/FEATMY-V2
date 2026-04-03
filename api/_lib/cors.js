/**
 * api/_lib/cors.js
 *
 * Helper centralizado de CORS.
 *
 * Comportamento por ambiente:
 * - Produção: fail-closed — origin não permitida lança erro (nunca retorna fallback silencioso)
 * - Dev: permite localhost automaticamente; sem APP_URL, usa localhost:3000
 *
 * APP_URL suporta múltiplas origens separadas por vírgula:
 *   APP_URL=https://featym.com,https://www.featym.com
 */

const ALLOWED_ORIGINS = new Set(
  (process.env.APP_URL || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

const isProd = process.env.NODE_ENV === 'production';

/**
 * Retorna a origin permitida para o request atual.
 *
 * Produção (fail-closed):
 *   - Origin na lista → retorna ela
 *   - Origin fora da lista ou ausente → lança erro
 *   - APP_URL não configurado → lança erro
 *
 * Desenvolvimento (fail-open para localhost):
 *   - localhost com qualquer porta → permitido
 *   - Origin na lista → retorna ela
 *   - Sem APP_URL → retorna localhost:3000 como fallback
 */
function getAllowedOrigin(req) {
  const requestOrigin = req?.headers?.origin || '';

  if (isProd) {
    // Produção: exige APP_URL configurado
    if (ALLOWED_ORIGINS.size === 0) {
      throw new Error(
        '[cors] APP_URL não configurado em produção. ' +
        'Adicione a variável de ambiente antes do deploy.'
      );
    }

    // Origin presente e permitida → OK
    if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
      return requestOrigin;
    }

    // Qualquer outro caso em produção → fail-closed
    // Não retorna fallback silencioso — força o browser a rejeitar
    throw new Error(
      `[cors] Origin não permitida: "${requestOrigin}". ` +
      `Origens aceitas: ${[...ALLOWED_ORIGINS].join(', ')}`
    );
  }

  // Desenvolvimento: localhost sempre permitido
  if (requestOrigin && requestOrigin.match(/^https?:\/\/localhost(:\d+)?$/)) {
    return requestOrigin;
  }

  // Origin na lista de dev → permitida
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    return requestOrigin;
  }

  // Fallback apenas em dev
  if (ALLOWED_ORIGINS.size > 0) return [...ALLOWED_ORIGINS][0];
  return 'http://localhost:3000';
}

/**
 * Aplica headers CORS no response.
 * Lança erro se a origin não for permitida (em produção).
 *
 * useCredentials: true quando o frontend envia cookies ou
 * Authorization header via fetch com credentials: 'include'.
 * Para este projeto (Bearer token no header), false é correto.
 */
function applyCors(req, res, methods = 'POST, OPTIONS', useCredentials = false) {
  const origin = getAllowedOrigin(req); // pode lançar em produção
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (useCredentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

module.exports = { getAllowedOrigin, applyCors };