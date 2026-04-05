/**
 * api/_lib/logger.js
 *
 * Helper de logging estruturado para as serverless functions.
 *
 * Em produção: emite JSON indexável pelo Vercel Log Drain.
 * Em desenvolvimento: emite texto legível no terminal.
 *
 * Níveis:
 *   info     — eventos normais de negócio
 *   warn     — situações inesperadas não críticas
 *   error    — erros que afetam o usuário
 *   security — tentativas de ataque, violações de acesso (prioridade de monitoramento)
 *
 * Uso:
 *   const { logger } = require('./_lib/logger');
 *   logger.info('create-charge', 'Cobrança criada', { uid, planId });
 *   logger.security('simulate-payment', 'Ownership violation', { uid, billingPersonalId });
 */

const isProd = process.env.NODE_ENV === 'production';

/**
 * Formata e emite um log.
 *
 * @param {'info'|'warn'|'error'|'security'} level
 * @param {string} service  - nome do endpoint/serviço (ex: 'create-charge')
 * @param {string} message  - mensagem legível
 * @param {object} [data]   - dados adicionais estruturados (sem dados sensíveis)
 */
function log(level, service, message, data = {}) {
  const entry = {
    level,
    service,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  };

  if (isProd) {
    // JSON em produção — indexável pelo Vercel Log Drain e ferramentas externas
    // Use console.error para 'error' e 'security' para garantir que apareçam
    // mesmo em ambientes que filtram console.log por padrão
    const output = JSON.stringify(entry);
    if (level === 'error' || level === 'security') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  } else {
    // Texto legível em desenvolvimento
    const prefix = {
      info:     '📋',
      warn:     '⚠️ ',
      error:    '❌',
      security: '🚨',
    }[level] || '📋';

    const dataStr = Object.keys(data).length > 0
      ? ' ' + JSON.stringify(data)
      : '';

    const fn = level === 'error' || level === 'security'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;

    fn(`${prefix} [${service}] ${message}${dataStr}`);
  }
}

const logger = {
  /**
   * Eventos normais de negócio.
   * Ex: cobrança criada, assinatura ativada.
   */
  info: (service, message, data) => log('info', service, message, data),

  /**
   * Situações inesperadas não críticas.
   * Ex: QR Code expirado, rate limit atingido.
   */
  warn: (service, message, data) => log('warn', service, message, data),

  /**
   * Erros que afetam o usuário.
   * Ex: Firebase indisponível, AbacatePay com erro.
   */
  error: (service, message, data) => log('error', service, message, data),

  /**
   * Tentativas de ataque ou violações de acesso.
   * PRIORIDADE MÁXIMA de monitoramento — spike = alguém explorando.
   * Ex: HMAC inválido no webhook, ownership violation, CORS bloqueado.
   */
  security: (service, message, data) => log('security', service, message, data),
};

module.exports = { logger };