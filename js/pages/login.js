/**
 * js/pages/login.js
 * Migrado de script inline em pages/login.html
 */
window.__pageInit = async function() {
  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return;

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email     = document.getElementById('loginEmail').value;
    const password  = document.getElementById('loginPassword').value;
    const errorDiv  = document.getElementById('loginError');
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const origText  = submitBtn.textContent;

    submitBtn.textContent = 'Entrando...';
    submitBtn.disabled    = true;
    submitBtn.style.opacity = '0.75';

    try {
      const result = await authManager.login(email, password);
      if (result.success) {
        if (result.userType === 'personal') router.goToPersonalDashboard();
        else router.goToStudentDashboard();
      } else {
        errorDiv.textContent   = result.error;
        errorDiv.style.display = 'block';
        submitBtn.textContent  = origText;
        submitBtn.disabled     = false;
        submitBtn.style.opacity = '1';
      }
    } catch {
      errorDiv.textContent   = 'Erro ao fazer login. Tente novamente.';
      errorDiv.style.display = 'block';
      submitBtn.textContent  = origText;
      submitBtn.disabled     = false;
      submitBtn.style.opacity = '1';
    }
  });
};
