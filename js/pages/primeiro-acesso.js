/**
 * js/pages/primeiro-acesso.js
 * Migrado de script inline em pages/primeiro-acesso.html
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

  function getTokenFromUrl() {
    const search = new URLSearchParams(window.location.search);
    if (search.has('token')) return search.get('token');
    const hash = window.location.hash || '';
    const qi   = hash.indexOf('?');
    if (qi === -1) return null;
    return new URLSearchParams(hash.slice(qi)).get('token') || null;
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

  async function init() {
    activationToken = getTokenFromUrl();

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

    const result = await authManager.activateStudentAccount(
      activationData.email,
      password,
      activationData.studentDocId,
      activationToken,
      activationData.emailKey
    );

    if (result.success) {
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
