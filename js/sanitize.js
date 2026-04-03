/**
 * js/sanitize.js
 *
 * Helper centralizado de sanitização XSS.
 *
 * Por que não DOMPurify:
 * - Este projeto usa HTML vanilla com fetch de páginas e new Function() para scripts.
 * - DOMPurify funcionaria, mas adiciona ~45KB de dependência para um caso cobrível
 *   com escapeHtml() puro, dado que não renderizamos HTML rico vindo do usuário.
 * - Todos os dados do Firestore (nomes, emails, comentários) são texto puro —
 *   não há necessidade de preservar tags HTML legítimas nesses campos.
 *
 * Uso:
 *   import { esc } from './sanitize.js';
 *   card.innerHTML = `<h3>${esc(ex.name)}</h3>`;
 *
 * Ou via window.esc (carregado antes de router.js):
 *   card.innerHTML = `<h3>${esc(ex.name)}</h3>`;
 *
 * REGRA: Qualquer dado vindo do Firestore ou de input do usuário
 * que seja interpolado em innerHTML DEVE passar por esc().
 * Se o campo pode conter HTML intencional, use DOMPurify.
 */

/**
 * Escapa caracteres HTML especiais em uma string.
 * Converte: & " ' < > / em entidades HTML seguras.
 *
 * @param {*} value - Qualquer valor. null/undefined retornam string vazia.
 * @returns {string} String com caracteres especiais escapados.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\//g, '&#x2F;');
}

// Alias curto para uso em template literals
const esc = escapeHtml;

// Expor globalmente — carregado antes de router.js via index.html
window.escapeHtml = escapeHtml;
window.esc = esc;