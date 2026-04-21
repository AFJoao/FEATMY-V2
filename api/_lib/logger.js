/**
 * api/_lib/logger.js — v2
 *
 * CORREÇÃO 3.13 — Logs agora incluem requestId (correlation ID).
 * Antes: impossível rastrear uma requisição específica em produção
 * com múltiplas instâncias.
 * Agora: cada handler pode criar um requestId e passá-lo nos logs.
 *
 * Uso nos handlers:
 *
 *   const { logger, createRequestLogger } = require('../_lib/logger');
 *
 *   module.exports = async function handler(req, res) {
 *     const { randomUUID } = require('crypto');
 *     const requestId = randomUUID();
 *     res.setHeader('X-Request-Id', requestId);
 *     const log = createRequestLogger(requestId);
 *
 *     log.info('create-charge', 'Iniciando cobrança', { uid });
 *     log.security('create-charge', 'Rate limit atingido', { uid, reason });
 *   };
 */

const isProd = process.env.NODE_ENV === 'production';

/**
 * Formata e emite um log.
 *
 * @param {'info'|'warn'|'error'|'security'} level
 * @param {string} service    - nome do endpoint/serviço
 * @param {string} message    - mensagem legível
 * @param {object} [data]     - dados adicionais estruturados
 * @param {string} [requestId] - correlation ID do request (opcional)
 */
function log(level, service, message, data = {}, requestId = null) {
  const entry = {
    level,
    service,
    message,
    timestamp: new Date().toISOString(),
    ...(requestId ? { requestId } : {}),
    ...data,
  };

  if (isProd) {
    const output = JSON.stringify(entry);
    if (level === 'error' || level === 'security') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  } else {
    const prefix = {
      info:     '📋',
      warn:     '⚠️ ',
      error:    '❌',
      security: '🚨',
    }[level] || '📋';

    const reqStr  = requestId ? ` [${requestId.slice(0, 8)}]` : '';
    const dataStr = Object.keys(data).length > 0 ? ' ' + JSON.stringify(data) : '';

    const fn = level === 'error' || level === 'security'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;

    fn(`${prefix}${reqStr} [${service}] ${message}${dataStr}`);
  }
}

const logger = {
  info:     (service, message, data) => log('info',     service, message, data),
  warn:     (service, message, data) => log('warn',     service, message, data),
  error:    (service, message, data) => log('error',    service, message, data),
  security: (service, message, data) => log('security', service, message, data),
};

/**
 * CORREÇÃO 3.13 — Cria um logger com requestId fixo para um handler específico.
 * Todas as chamadas incluirão automaticamente o correlation ID.
 *
 * @param {string} requestId - UUID do request
 * @returns {{ info, warn, error, security }} logger com requestId embutido
 */
function createRequestLogger(requestId) {
  return {
    info:     (service, message, data = {}) => log('info',     service, message, data, requestId),
    warn:     (service, message, data = {}) => log('warn',     service, message, data, requestId),
    error:    (service, message, data = {}) => log('error',    service, message, data, requestId),
    security: (service, message, data = {}) => log('security', service, message, data, requestId),
  };
}

module.exports = { logger, createRequestLogger };