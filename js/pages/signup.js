/**
 * js/pages/signup.js
 * Migrado de script inline em pages/signup.html
 */
window.__pageInit = async function() {
  const form      = document.getElementById('signupForm');
  const errDiv    = document.getElementById('signupError');
  const okDiv     = document.getElementById('signupSuccess');
  const submitBtn = document.getElementById('signupSubmitBtn');

  if (!form) return;

  function showError(msg) {
    errDiv.textContent   = msg;
    errDiv.style.display = 'block';
    okDiv.style.display  = 'none';
  }

  function resetBtn() {
    submitBtn.textContent = 'Criar minha conta';
    submitBtn.disabled    = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errDiv.style.display = 'none';
    okDiv.style.display  = 'none';

    const name     = document.getElementById('signupName').value.trim();
    const email    = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm  = document.getElementById('signupPasswordConfirm').value;

    if (password !== confirm) return showError('As senhas não conferem.');

    submitBtn.innerHTML = '<span class="spinner"></span>';
    submitBtn.disabled  = true;

    const result = await authManager.signupPersonal(email, password, name);

    if (result.success) {
      okDiv.innerHTML     = '<strong>Conta criada com sucesso!</strong> Redirecionando...';
      okDiv.style.display = 'block';
      setTimeout(() => router.goToPersonalDashboard(), 1800);
    } else {
      showError(result.error || 'Erro ao criar conta.');
      resetBtn();
    }
  });
};
