/**
 * GET /api/health
 *
 * CORREÇÃO 6.5 — Health check endpoint para monitoramento de disponibilidade.
 * Permite que serviços de uptime monitoring verifiquem se o backend está
 * funcionando sem fazer operações reais no banco de dados.
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 'no-store');

  return res.status(200).json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    version:   process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown',
    env:       process.env.NODE_ENV || 'unknown',
  });
};