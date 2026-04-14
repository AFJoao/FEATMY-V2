/**
 * api/_lib/cors.js
 *
 * Helper centralizado de CORS.
 *
 * CORREÇÃO v2:
 *   Em produção sem APP_URL configurada, o comportamento anterior lançava
 *   uma exceção que retornava 403 em TODAS as requisições — derrubando
 *   o dashboard inteiro mesmo que o usuário estivesse autenticado.
 *
 *   Novo comportamento:
 *   - APP_URL ausente em produção: loga erro crítico + permite requisição
 *     (fail-open controlado). O handler ainda pode rejeitar por token inválido.
 *   - Origin não permitida em produção: bloqueia com 403 (fail-closed).
 *   - Em dev: sempre permissivo para localhost.
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
 * CORRIGIDO v2:
 *   Produção sem APP_URL → loga erro mas retorna '*' em vez de lançar.
 *   Isso evita que uma variável de ambiente faltando derrube toda a API.
 *   O erro no log é suficiente para alertar — o deploy deve ter APP_URL.
 *
 *   Produção com APP_URL mas origin não permitida → lança (fail-closed).
 */
function getAllowedOrigin(req) {
  const requestOrigin = req?.headers?.origin || '';

  if (isProd) {
    // APP_URL não configurada: loga erro crítico mas não bloqueia
    if (ALLOWED_ORIGINS.size === 0) {
      console.error(
        '[cors] CRÍTICO: APP_URL não configurada em produção. ' +
        'Configure a variável de ambiente na Vercel. Permitindo request sem restrição de origin.'
      );
      return requestOrigin || '*';
    }

    // Origin presente e permitida → OK
    if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
      return requestOrigin;
    }

    // Sem origin no header (ex: chamadas server-side, Postman, cron) → permite
    // Requisições sem origin são feitas por servidores, não por browsers
    if (!requestOrigin) {
      return '*';
    }

    // Origin presente mas não permitida → fail-closed
    throw new Error(
      `[cors] Origin não permitida: "${requestOrigin}". ` +
      `Origens aceitas: ${[...ALLOWED_ORIGINS].join(', ')}`
    );
  }

  // Desenvolvimento: localhost sempre permitido
  if (requestOrigin && requestOrigin.match(/^https?:\/\/localhost(:\d+)?$/)) {
    return requestOrigin;
  }

  // Origin na lista → permitida
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    return requestOrigin;
  }

  // Fallback dev
  if (ALLOWED_ORIGINS.size > 0) return [...ALLOWED_ORIGINS][0];
  return 'http://localhost:3000';
}

/**
 * Aplica headers CORS no response.
 */
function applyCors(req, res, methods = 'POST, OPTIONS', useCredentials = false) {
  const origin = getAllowedOrigin(req); // pode lançar em produção com origin inválida
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (useCredentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

module.exports = { getAllowedOrigin, applyCors }; 