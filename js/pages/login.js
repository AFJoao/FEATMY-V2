/**
 * js/pages/login.js
 */
window.__pageInit = async function() {

  const loginForm = document.getElementById('loginForm');
  if (!loginForm) {
    console.error('[login] loginForm não encontrado!');
    return;
  }

  console.log('[login] loginForm encontrado, adicionando listener');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('[login] submit disparado');

    const email     = document.getElementById('loginEmail').value;
    const password  = document.getElementById('loginPassword').value;
    const errorDiv  = document.getElementById('loginError');
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const origText  = submitBtn.textContent;

    console.log('[login] email:', email, '| authManager disponível:', typeof authManager !== 'undefined');

    submitBtn.textContent   = 'Entrando...';
    submitBtn.disabled      = true;
    submitBtn.style.opacity = '0.75';

    try {
      console.log('[login] chamando authManager.login...');
      const result = await authManager.login(email, password);
      console.log('[login] resultado:', result);

      if (result.success) {
        console.log('[login] sucesso! userType:', result.userType, '| router disponível:', typeof router !== 'undefined');
        if (result.userType === 'personal') {
          console.log('[login] redirecionando para personal dashboard...');
          router.goToPersonalDashboard();
        } else {
          console.log('[login] redirecionando para student dashboard...');
          router.goToStudentDashboard();
        }
      } else {
        console.warn('[login] falha no login:', result.error);
        errorDiv.textContent   = result.error;
        errorDiv.style.display = 'block';
        submitBtn.textContent  = origText;
        submitBtn.disabled     = false;
        submitBtn.style.opacity = '1';
      }
    } catch (err) {
      console.error('[login] erro inesperado:', err);
      errorDiv.textContent   = 'Erro ao fazer login. Tente novamente.';
      errorDiv.style.display = 'block';
      submitBtn.textContent  = origText;
      submitBtn.disabled     = false;
      submitBtn.style.opacity = '1';
    }
  });

  console.log('[login] listener adicionado com sucesso');
};