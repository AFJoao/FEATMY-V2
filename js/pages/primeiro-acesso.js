/**
 * js/pages/primeiro-acesso.js — v3
 *
 * CORREÇÕES v3 (SEGURANÇA):
 * 1. Fluxo de ativação 100% server-side:
 *    - checkTokenViaAPI() valida token em /api/activation/check
 *    - activateViaAPI() ativa em /api/activation/activate (lock atômico)
 *    - Removida completamente a tentativa de ativação client-side via authManager
 *    - Race condition de ativação dupla eliminada
 *
 * 2. Token extraído da URL imediatamente e limpo do histórico — mantido da v2.
 *
 * 3. Suporte a hash fragment (#token=) e query string (?token=) — mantido da v2.
 */
window.__pageInit = async function() {
  let activationData  = null;
  let activationToken = null;
  let isActivating    = false;

  function showStep(id) {
    ['stepLoading', 'stepInvalid', 'stepPassword'].forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('active', s === id);
    });
  }

  function showError(msg) {
    const el = document.getElementById('stepError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function hideError() {
    const el = document.getElementById('stepError');
    if (el) el.style.display = 'none';
  }

  /**
   * Extrai token da URL e limpa imediatamente do histórico/URL visível.
   * Suporta:
   *   - /#/primeiro-acesso#token=ABC (hash fragment — seguro)
   *   - /#/primeiro-acesso?token=ABC (query string — legado)
   */
  function extractAndClearToken() {
    const fullHash = window.location.hash || '';

    // Tentar hash fragment: /#/primeiro-acesso#token=ABC
    const hashTokenMatch = fullHash.match(/[#&]token=([a-f0-9]{64})/);
    if (hashTokenMatch) {
      const token = hashTokenMatch[1];
      history.replaceState(null, '', window.location.pathname + '#/primeiro-acesso');
      return token;
    }

    // Fallback: query string /?token=ABC (legado)
    const search = new URLSearchParams(window.location.search);
    if (search.has('token')) {
      const token = search.get('token');
      history.replaceState(null, '', window.location.pathname + '#/primeiro-acesso');
      return token;
    }

    // Hash como query: /#/primeiro-acesso?token=ABC
    const hashQueryMatch = fullHash.match(/\?token=([a-f0-9]{64})/);
    if (hashQueryMatch) {
      const token = hashQueryMatch[1];
      history.replaceState(null, '', window.location.pathname + '#/primeiro-acesso');
      return token;
    }

    return null;
  }

  async function checkTokenViaAPI(token) {
    try {
      const res  = await fetch('/api/activation/check', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.status === 200 && data.valid) return { ok: true, data };
      if (res.status === 410) return { ok: false, expired: true,       message: data.error };
      if (res.status === 409) return { ok: false, alreadyActive: true, message: data.error };
      if (res.status === 429) return { ok: false, rateLimited: true,   message: data.error };
      return { ok: false, message: data.error || 'Link inválido ou expirado.' };
    } catch {
      return { ok: false, message: 'Erro de conexão. Verifique sua internet e tente novamente.' };
    }
  }

  /**
   * activateViaAPI — SECURITY FIX: única forma de ativar conta.
   * O servidor usa lock atômico via Firestore Transaction para prevenir
   * ativação dupla mesmo sob condições de concorrência.
   */
  async function activateViaAPI(token, password, email) {
    try {
      const res  = await fetch('/api/activation/activate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password, email }),
      });
      const data = await res.json();
      if (res.ok && data.success) return { success: true, customToken: data.customToken };
      return { success: false, error: data.error || 'Erro ao ativar conta.' };
    } catch {
      return { success: false, error: 'Erro de conexão. Tente novamente.' };
    }
  }

  async function init() {
    // Extrair e limpar token da URL ANTES de qualquer outra operação
    activationToken = extractAndClearToken();

    if (!activationToken) {
      const msg = document.getElementById('invalidMsg');
      if (msg) msg.innerHTML =
        'Para ativar sua conta, use o link enviado pelo seu personal trainer.<br><br>' +
        'Se você já ativou sua conta, <a href="#/login" style="color:#BE123C;font-weight:700;">faça login aqui</a>.';
      showStep('stepInvalid');
      return;
    }

    showStep('stepLoading');
    const result = await checkTokenViaAPI(activationToken);

    if (!result.ok) {
      const msg = document.getElementById('invalidMsg');
      if (msg) msg.innerHTML = result.alreadyActive
        ? `Conta já ativada. <a href="#/login" style="color:#BE123C;font-weight:700;">Faça login aqui →</a>`
        : (result.message || 'Link de ativação inválido ou expirado. Solicite um novo ao seu personal trainer.');
      showStep('stepInvalid');
      return;
    }

    activationData = result.data;
    const nameEl = document.getElementById('welcomeName');
    if (nameEl) nameEl.textContent = activationData.name;
    showStep('stepPassword');
    setTimeout(() => document.getElementById('passwordInput')?.focus(), 100);
  }

  async function activate() {
    if (isActivating || !activationData) return;
    hideError();

    const password = document.getElementById('passwordInput').value;
    const confirm  = document.getElementById('passwordConfirmInput').value;

    if (password.length < 6) return showError('A senha deve ter pelo menos 6 caracteres.');
    if (password !== confirm) return showError('As senhas não conferem.');

    isActivating = true;
    const btn    = document.getElementById('activateBtn');
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled  = true;

    // SECURITY FIX: ativação EXCLUSIVAMENTE via API server-side (lock atômico)
    const result = await activateViaAPI(activationToken, password, activationData.email);

    if (result.success) {
      // Login com custom token gerado pelo servidor
      try {
        if (result.customToken) {
          await auth.signInWithCustomToken(result.customToken);
          await authManager.reinitialize();
        }
      } catch (e) {
        console.warn('[primeiro-acesso] Custom token login falhou, tentando login direto:', e.message);
        try {
          await auth.signInWithEmailAndPassword(activationData.email, password);
          await authManager.reinitialize();
        } catch (loginErr) {
          console.error('[primeiro-acesso] Login fallback falhou:', loginErr.message);
        }
      }

      const stepEl = document.getElementById('stepPassword');
      if (stepEl) stepEl.innerHTML = `
        <div style="text-align:center;padding:20px 0;">
          <div style="width:56px;height:56px;background:#00E676;border-radius:16px;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 style="font-size:1.4rem;font-weight:800;color:#0A0A0A;margin:0 0 8px;">Conta ativada!</h2>
          <p style="color:#6B7280;font-size:0.875rem;margin:0 0 24px;">Redirecionando para seus treinos...</p>
          <div class="spinner" style="margin:0 auto;"></div>
        </div>`;
      setTimeout(() => router.goToStudentDashboard(), 2000);
    } else {
      showError(result.error || 'Erro ao ativar conta. Tente novamente.');
      btn.innerHTML = 'Ativar minha conta';
      btn.disabled  = false;
      isActivating  = false;
    }
  }

  document.getElementById('activateBtn')?.addEventListener('click', activate);
  document.getElementById('passwordConfirmInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') activate();
  });

  await init();
};