/**
 * js/pages/recuperar-senha.js
 * Migrado de script inline em pages/recuperar-senha.html
 */
window.__pageInit = async function() {
  const DEBUG = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (typeof auth === 'undefined' || !auth) {
    console.error('[recuperar-senha] auth não encontrado.');
    return;
  }

  const rsEmail      = document.getElementById('rsEmail');
  const rsSubmitBtn  = document.getElementById('rsSubmitBtn');
  const rsError      = document.getElementById('rsError');
  const formBox      = document.getElementById('formBox');
  const successBox   = document.getElementById('successBox');
  const successEmail = document.getElementById('successEmail');
  const reTryBtn     = document.getElementById('reTryBtn');

  if (!rsEmail || !rsSubmitBtn || !rsError || !formBox || !successBox) return;

  const BTN_LABEL = 'Enviar link de recuperação';

  function showError(msg) { rsError.textContent = msg; rsError.style.display = 'block'; }
  function hideError()    { rsError.style.display = 'none'; }
  function setLoading(on) {
    rsSubmitBtn.innerHTML = on ? '<span class="spinner"></span>' : BTN_LABEL;
    rsSubmitBtn.disabled  = on;
  }
  function showSuccess(email) {
    if (successEmail) successEmail.textContent = email;
    formBox.classList.add('hidden');
    successBox.classList.add('visible');
    setLoading(false);
  }
  function showForm() {
    rsEmail.value = '';
    hideError();
    setLoading(false);
    formBox.classList.remove('hidden');
    successBox.classList.remove('visible');
    setTimeout(() => rsEmail.focus(), 80);
  }

  function translateResetError(code) {
    const map = {
      'auth/too-many-requests':      'Muitas tentativas seguidas. Aguarde alguns minutos.',
      'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.',
      'auth/invalid-email':          'Formato de e-mail inválido.',
    };
    return map[code] || 'Não foi possível processar a solicitação. Tente novamente.';
  }

  let lastSentAt    = 0;
  const COOLDOWN_MS = 30_000;

  async function sendReset() {
    hideError();
    const email = rsEmail.value.trim();
    if (!email) { showError('Informe o seu e-mail.'); rsEmail.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Formato de e-mail inválido.'); rsEmail.focus(); return; }

    const now = Date.now();
    if (now - lastSentAt < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (now - lastSentAt)) / 1000);
      showError(`Aguarde ${remaining}s antes de solicitar outro e-mail.`);
      return;
    }

    setLoading(true);
    try {
      await auth.sendPasswordResetEmail(email);
      lastSentAt = Date.now();
      showSuccess(email);
    } catch (error) {
      const silentCodes = new Set(['auth/user-not-found', 'auth/user-disabled']);
      if (silentCodes.has(error.code)) { lastSentAt = Date.now(); showSuccess(email); return; }
      if (DEBUG) console.warn('[recuperar-senha]', error.code, error.message);
      showError(translateResetError(error.code));
      setLoading(false);
    }
  }

  rsSubmitBtn.addEventListener('click', sendReset);
  rsEmail.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReset(); });
  if (reTryBtn) reTryBtn.addEventListener('click', showForm);

  setTimeout(() => rsEmail.focus(), 100);
};
