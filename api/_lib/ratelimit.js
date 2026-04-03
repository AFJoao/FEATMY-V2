/**
 * api/_lib/ratelimit.js
 *
 * Rate limiting persistente via Upstash Redis.
 * Funciona corretamente em ambiente serverless (Vercel Functions).
 *
 * Comportamento por ambiente:
 * - Produção: fail-closed — sem Redis configurado, lança erro e bloqueia o request
 * - Dev: fail-open — sem Redis, loga aviso e permite (não quebra o dev local)
 *
 * Estratégia dupla (UID + IP):
 * - Por UID: impede abuso por usuário autenticado
 * - Por IP: impede bypass via múltiplas contas e protege endpoints pré-auth
 *
 * Limites por contexto:
 * - billing:  10 req/min  (retry natural de UI + tentativas legítimas de pagamento)
 * - auth:      5 req/min  (login, signup — sensível a brute force)
 * - api:      60 req/min  (endpoints gerais)
 *
 * Setup Upstash (5 min):
 * 1. Crie conta em https://upstash.com
 * 2. Crie um Redis database (free tier: 10k req/dia)
 * 3. Copie UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN
 * 4. Adicione as variáveis no painel da Vercel (Settings → Environment Variables)
 */

let Ratelimit, Redis;

try {
  ({ Ratelimit } = require('@upstash/ratelimit'));
  ({ Redis }     = require('@upstash/redis'));
} catch {
  // Pacotes não instalados — tratado abaixo por ambiente
}

const isProd = process.env.NODE_ENV === 'production';

// ── Instâncias singleton por tipo de limiter ─────────────────────
const limiters = {};

function getLimiter(type) {
  if (limiters[type]) return limiters[type];

  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token || !Ratelimit || !Redis) {
    if (isProd) {
      // Produção sem Redis: fail-closed — não permite nada passar
      throw new Error(
        '[ratelimit] Upstash não configurado em produção. ' +
        'Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN.'
      );
    }
    // Dev sem Redis: fail-open com aviso
    console.warn(
      '[ratelimit] Upstash não configurado. ' +
      'Rate limiting desativado em desenvolvimento.'
    );
    return null;
  }

  const redis = new Redis({ url, token });

  // Limites calibrados por contexto de uso real
  const configs = {
    billing: Ratelimit.slidingWindow(10, '60 s'), // 10/min — pagamentos
    auth:    Ratelimit.slidingWindow(5,  '60 s'), // 5/min  — login/signup
    api:     Ratelimit.slidingWindow(60, '60 s'), // 60/min — endpoints gerais
  };

  if (!configs[type]) {
    throw new Error(`[ratelimit] Tipo de limiter desconhecido: "${type}"`);
  }

  limiters[type] = new Ratelimit({
    redis,
    limiter:   configs[type],
    analytics: false,
    prefix:    `featym_rl_${type}`,
  });

  return limiters[type];
}

/**
 * Extrai o IP real do request, considerando proxies (Vercel usa x-forwarded-for).
 * Pega apenas o primeiro IP da lista para evitar spoofing via header forjado.
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || '';
  // x-forwarded-for pode ser "IP1, IP2, IP3" — o primeiro é o cliente real
  const first = forwarded.split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

/**
 * Verifica rate limit para um identificador.
 * Uso interno — prefira checkRateLimitDual para endpoints autenticados.
 *
 * @param {string} identifier - chave única (ex: "billing:uid:abc123")
 * @param {string} type       - "billing" | "auth" | "api"
 * @returns {{ limited: boolean, reset: number }}
 */
async function checkRateLimit(identifier, type = 'api') {
  let rl;

  try {
    rl = getLimiter(type);
  } catch (err) {
    // Em produção, getLimiter lança se Redis não configurado — propagamos
    throw err;
  }

  // Dev sem Redis: fail-open
  if (!rl) return { limited: false, reset: 0 };

  try {
    const { success, reset } = await rl.limit(identifier);
    return { limited: !success, reset };
  } catch (err) {
    // Erro de conexão com Redis em produção: fail-closed por segurança
    if (isProd) {
      console.error('[ratelimit] Erro de conexão com Redis em produção:', err.message);
      throw new Error('[ratelimit] Serviço de rate limiting indisponível');
    }
    // Dev: fail-open
    console.error('[ratelimit] Erro ao verificar limite (dev):', err.message);
    return { limited: false, reset: 0 };
  }
}

/**
 * Verificação dupla: por UID e por IP.
 *
 * Protege contra:
 * - Abuso por usuário autenticado (limite por UID)
 * - Bypass via múltiplas contas (limite por IP)
 * - Ataques pré-autenticação (limite por IP mesmo sem UID)
 *
 * @param {object} req  - request do handler
 * @param {string} uid  - UID do usuário autenticado (pode ser null para endpoints públicos)
 * @param {string} type - "billing" | "auth" | "api"
 * @returns {{ limited: boolean, reset: number, reason: string }}
 */
async function checkRateLimitDual(req, uid, type = 'api') {
  const ip = getClientIp(req);

  // Verificar por UID primeiro (se autenticado)
  if (uid) {
    const byUid = await checkRateLimit(`${type}:uid:${uid}`, type);
    if (byUid.limited) {
      return { ...byUid, reason: 'uid' };
    }
  }

  // Verificar por IP (sempre — protege mesmo sem autenticação)
  const byIp = await checkRateLimit(`${type}:ip:${ip}`, type);
  if (byIp.limited) {
    return { ...byIp, reason: 'ip' };
  }

  return { limited: false, reset: 0, reason: null };
}

module.exports = { checkRateLimit, checkRateLimitDual, getClientIp };