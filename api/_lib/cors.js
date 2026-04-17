/**
 * api/_lib/cors.js — v3
 *
 * CORREÇÃO v3 (VULN 8):
 *   Em produção sem APP_URL, o comportamento anterior era fail-open (permitia tudo).
 *   Isso anulava toda a proteção CORS se a variável de ambiente falhasse no deploy.
 *
 *   Novo comportamento fail-CLOSED:
 *   - APP_URL ausente em produção: loga erro CRÍTICO e lança exceção (bloqueia request)
 *   - Origin não permitida em produção: lança exceção (bloqueia request)
 *   - Requisições sem origin (server-to-server): sempre permitidas (não são CSRF)
 *   - Em desenvolvimento: permissivo para localhost
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
 * FAIL-CLOSED em produção:
 *   - Sem APP_URL: lança (bloqueia tudo — misconfiguration não deve ser silenciosa)
 *   - Origin não permitida: lança
 *
 * Requisições sem origin header (Postman, server-to-server, cron):
 *   - Sempre permitidas: não são requests de browser, logo não são vetores CSRF
 */
function getAllowedOrigin(req) {
  const requestOrigin = req?.headers?.origin || '';

  if (isProd) {
    if (ALLOWED_ORIGINS.size === 0) {
      // FAIL-CLOSED: APP_URL não configurada em produção é erro bloqueante
      console.error(
        '[cors] CRÍTICO: APP_URL não configurada em produção. ' +
        'Configure a variável de ambiente na Vercel. Bloqueando request.'
      );
      throw new Error('[cors] APP_URL não configurada em produção — request bloqueado');
    }

    // Sem origin no header → server-to-server ou cron → permitir
    if (!requestOrigin) {
      return '*';
    }

    // Origin na lista → OK
    if (ALLOWED_ORIGINS.has(requestOrigin)) {
      return requestOrigin;
    }

    // Origin presente mas não permitida → FAIL-CLOSED
    throw new Error(
      `[cors] Origin não permitida: "${requestOrigin}". ` +
      `Origens aceitas: ${[...ALLOWED_ORIGINS].join(', ')}`
    );
  }

  // Desenvolvimento: localhost sempre permitido
  if (requestOrigin && requestOrigin.match(/^https?:\/\/localhost(:\d+)?$/)) {
    return requestOrigin;
  }

  // Origin na lista em dev → permitida
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    return requestOrigin;
  }

  // Fallback dev
  if (ALLOWED_ORIGINS.size > 0) return [...ALLOWED_ORIGINS][0];
  return 'http://localhost:3000';
}

/**
 * Aplica headers CORS no response.
 * Lança se a origin não for permitida (caller deve capturar e retornar 403).
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