/**
 * js/pages/personal/dashboard.js — v2
 *
 * CORREÇÃO v2 (VULN 3):
 * - regenerateActivationLink usa hash fragment (#token=) em vez de ?token=
 *   Token não vaza em logs de CDN, Vercel, analytics ou header Referer
 *
 * Todas as correções v1 mantidas.
 */

window.__pageInit = async function() {
  await new Promise(r => setTimeout(r, 120));

  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\//g, '&#x2F;');
  };

  // ── Logout ──────────────────────────────────────────────────
  document.getElementById('logoutBtn').onclick = async () => {
    await authManager.logout();
    router.goToLogin();
  };

  // ── Nome do personal ─────────────────────────────────────────
  dbManager.getCurrentUserData().then(d => {
    const nameEl = document.getElementById('personalName');
    if (nameEl) nameEl.textContent = d?.name || 'Personal';
  });

  // ── Modal ─────────────────────────────────────────────────────
  const overlay  = document.getElementById('modalOverlay');
  const modalErr = document.getElementById('modalError');

  const openModal = () => {
    document.getElementById('newStudentName').value  = '';
    document.getElementById('newStudentEmail').value = '';
    modalErr.style.display = 'none';
    overlay.classList.add('open');
    setTimeout(() => document.getElementById('newStudentName').focus(), 150);
  };
  const closeModal = () => overlay.classList.remove('open');

  document.getElementById('addStudentBtn').onclick = openModal;
  document.getElementById('closeModal').onclick    = closeModal;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // ── Reenvio de link de ativação ───────────────────────────────
  async function regenerateActivationLink(studentDocId, studentEmail) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const newToken  = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const emailKey  = studentEmail.toLowerCase().replace(/[^a-z0-9]/g, '_');

    await db.collection('pendingActivations').doc(emailKey).set({
      studentDocId,
      activationToken: newToken,
      createdBy:       authManager.getCurrentUser().uid,
      status:          'pending',
      expiresAt:       firebase.firestore.Timestamp.fromDate(expiresAt),
      updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // CORREÇÃO VULN 3: Hash fragment (#token=) — não vaza em logs
    return `${window.location.origin}/#/primeiro-acesso#token=${newToken}`;
  }

  // ── Criar aluno ────────────────────────────────────────────────
  document.getElementById('createStudentBtn').onclick = async () => {
    const name  = document.getElementById('newStudentName').value.trim();
    const email = document.getElementById('newStudentEmail').value.trim();
    const btn   = document.getElementById('createStudentBtn');

    modalErr.style.display = 'none';
    if (!name || !email) {
      modalErr.textContent   = 'Preencha nome e e-mail.';
      modalErr.style.display = 'block';
      return;
    }

    btn.textContent = 'Criando...';
    btn.disabled    = true;

    const result = await authManager.createStudentAccount(name, email);

    if (result.success) {
      const modalBox = document.querySelector('#modalOverlay .modal-box');
      if (modalBox) {
        modalBox.innerHTML = `
          <div>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
              <div style="width:40px;height:40px;background:#00E676;border-radius:12px;
                          display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="#0A0A0A" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <h3 style="font-size:1rem;font-weight:800;color:#0A0A0A;margin:0 0 2px;">
                  Aluno criado!
                </h3>
                <p style="font-size:0.78rem;color:#9CA3AF;margin:0;">
                  Envie o link abaixo para ${esc(name)} ativar a conta
                </p>
              </div>
            </div>
            <div style="background:#F8F9FA;border:1px solid #EBEBEB;border-radius:12px;
                        padding:14px 16px;margin-bottom:16px;">
              <p style="font-size:0.7rem;font-weight:700;color:#9CA3AF;
                         text-transform:uppercase;letter-spacing:0.06em;margin:0 0 8px;">
                Link de primeiro acesso
              </p>
              <p id="activationUrlText"
                 style="font-size:0.78rem;color:#374151;word-break:break-all;
                         margin:0 0 10px;line-height:1.5;font-family:'DM Mono',monospace;
                         background:#fff;padding:10px;border-radius:8px;
                         border:1px solid #EBEBEB;">
                ${esc(result.activationUrl)}
              </p>
              <button id="copyActivationUrl"
                style="width:100%;padding:9px;background:#0A0A0A;color:#fff;border:none;
                       border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;
                       font-family:inherit;display:flex;align-items:center;
                       justify-content:center;gap:6px;transition:all 0.2s;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copiar link
              </button>
            </div>
            <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;
                        padding:11px 14px;margin-bottom:16px;">
              <p style="font-size:0.78rem;color:#92400E;margin:0;line-height:1.5;">
                <strong>⚠️ Importante:</strong> Este link é válido por 7 dias.
                Envie diretamente ao aluno por WhatsApp ou e-mail.
                Não compartilhe publicamente.
              </p>
            </div>
            <button id="closeActivationModal"
              style="width:100%;padding:12px;background:#F4F4F4;border:none;
                     border-radius:10px;font-size:0.875rem;font-weight:600;
                     color:#374151;cursor:pointer;font-family:inherit;">
              Fechar e atualizar lista
            </button>
          </div>`;

        document.getElementById('copyActivationUrl').onclick = async () => {
          try {
            await navigator.clipboard.writeText(result.activationUrl);
            const copyBtn = document.getElementById('copyActivationUrl');
            if (!copyBtn) return;
            copyBtn.innerHTML = '✓ Copiado!';
            copyBtn.style.background = '#059669';
            setTimeout(() => {
              if (!document.getElementById('copyActivationUrl')) return;
              copyBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copiar link`;
              copyBtn.style.background = '#0A0A0A';
            }, 3000);
          } catch {
            const urlEl = document.getElementById('activationUrlText');
            if (urlEl) {
              const range = document.createRange();
              range.selectNodeContents(urlEl);
              window.getSelection().removeAllRanges();
              window.getSelection().addRange(range);
            }
          }
        };

        document.getElementById('closeActivationModal').onclick = async () => {
          closeModal();
          await loadStudents();
        };
      }
    } else {
      modalErr.textContent   = result.error || 'Erro ao criar aluno.';
      modalErr.style.display = 'block';
      btn.textContent        = 'Criar conta do aluno';
      btn.disabled           = false;
    }
  };

  // ── Reload ────────────────────────────────────────────────────
  document.getElementById('reloadBtn').onclick = loadStudents;

  // ── Renderizar lista de alunos ────────────────────────────────
  async function loadStudents() {
    const list = document.getElementById('studentsList');
    list.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;">
        <div class="spinner" style="margin:0 auto 14px;"></div>
        <p style="color:#9CA3AF;font-size:0.875rem;margin:0;">Carregando...</p>
      </div>`;

    const students = await dbManager.getMyStudents();
    document.getElementById('studentsCount').textContent = students.length;

    if (students.length === 0) {
      list.innerHTML = `
        <div style="grid-column:1/-1;padding:48px 32px;background:#FAFAFA;
                    border-radius:16px;border:2px dashed #E5E7EB;text-align:center;">
          <div style="width:48px;height:48px;background:#F4F4F4;border-radius:12px;
                      margin:0 auto 14px;display:flex;align-items:center;
                      justify-content:center;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                 stroke="#9CA3AF" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <p style="font-size:1rem;font-weight:600;color:#374151;margin:0 0 6px;">
            Nenhum aluno ainda
          </p>
          <p style="font-size:0.85rem;color:#9CA3AF;margin:0;">
            Adicione seu primeiro aluno pelo botão acima
          </p>
        </div>`;
      return;
    }

    list.innerHTML = '';

    students.forEach(st => {
      const status   = st.status || 'active';
      const isActive = status === 'active';
      const initials = (st.name || 'A')
        .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
        .replace(/[^A-Z]/g, '');

      const badgeClass = {
        active:   'badge-active',
        pending:  'badge-pending',
        inactive: 'badge-inactive',
      }[status] || 'badge-inactive';

      const badgeLabel = {
        active:   'Ativo',
        pending:  'Pendente',
        inactive: 'Inativo',
      }[status] || status;

      const card = document.createElement('div');
      card.className = `student-card${isActive ? ' clickable' : ''}`;

      card.innerHTML = `
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="width:42px;height:42px;background:#0A0A0A;border-radius:11px;
                        display:flex;align-items:center;justify-content:center;
                        flex-shrink:0;">
              <span style="color:#00E676;font-size:0.85rem;font-weight:700;">
                ${esc(initials)}
              </span>
            </div>
            <div style="flex:1;min-width:0;">
              <p style="font-weight:700;font-size:0.95rem;color:#0A0A0A;
                         margin:0 0 2px;overflow:hidden;text-overflow:ellipsis;
                         white-space:nowrap;">
                ${esc(st.name)}
              </p>
              <p style="font-size:0.78rem;color:#9CA3AF;margin:0;overflow:hidden;
                         text-overflow:ellipsis;white-space:nowrap;">
                ${esc(st.email)}
              </p>
            </div>
            <span class="badge ${badgeClass}">${esc(badgeLabel)}</span>
          </div>
          ${status === 'pending' ? `
            <p style="font-size:0.74rem;color:#9CA3AF;margin:10px 0 0;
                       display:flex;align-items:center;gap:5px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Aguardando primeiro acesso
            </p>` : ''}
        </div>
        <div class="card-footer">
          ${isActive ? `
            <button class="card-action" data-action="deactivate"
                    data-id="${esc(st.uid)}" data-name="${esc(st.name)}"
                    style="background:#FFFBEB;color:#92400E;">
              Desativar
            </button>` : ''}
          ${status === 'inactive' ? `
            <button class="card-action" data-action="reactivate"
                    data-id="${esc(st.uid)}"
                    style="background:#ECFDF5;color:#047857;">
              Reativar
            </button>` : ''}
          ${status === 'pending' ? `
            <button class="card-action" data-action="resend"
                    data-id="${esc(st.uid)}" data-email="${esc(st.email)}"
                    data-name="${esc(st.name)}"
                    style="background:#EFF6FF;color:#1D4ED8;">
              🔗 Reenviar link
            </button>` : ''}
          <button class="card-action" data-action="delete"
                  data-id="${esc(st.uid)}" data-name="${esc(st.name)}"
                  style="background:#FFF1F2;color:#DC2626;margin-left:auto;">
            Excluir
          </button>
        </div>`;

      if (isActive) {
        card.querySelector('.card-body').onclick = () =>
          router.goTo(`/personal/student/${st.uid}`);
      }

      list.appendChild(card);
    });

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const { action, id, name, email } = btn.dataset;

        if (action === 'deactivate') {
          if (!confirm(`Desativar ${name}? O aluno não conseguirá mais fazer login.`)) return;
        } else if (action === 'delete') {
          if (!confirm(`Excluir permanentemente ${name}? Esta ação não pode ser desfeita.`)) return;
        }

        if (action === 'resend') {
          const orig = btn.textContent;
          btn.textContent = 'Gerando...';
          btn.disabled    = true;
          try {
            const url = await regenerateActivationLink(id, email);
            _showResendModal(url, name, overlay);
          } catch (err) {
            alert('Erro ao gerar novo link: ' + err.message);
          } finally {
            btn.textContent = orig;
            btn.disabled    = false;
          }
          return;
        }

        const orig = btn.textContent;
        btn.textContent = '...';
        btn.disabled    = true;

        const fns = {
          deactivate: () => authManager.deactivateStudent(id),
          reactivate: () => authManager.reactivateStudent(id),
          delete:     () => authManager.deleteStudent(id),
        };

        const result = await fns[action]();
        if (result.success) {
          await loadStudents();
        } else {
          alert('Erro: ' + result.error);
          btn.textContent = orig;
          btn.disabled    = false;
        }
      };
    });
  }

  function _showResendModal(url, studentName, overlay) {
    const modalBox = document.querySelector('#modalOverlay .modal-box');
    if (!modalBox) return;

    modalBox.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <div style="width:40px;height:40px;background:#EFF6FF;border-radius:12px;
                      display:flex;align-items:center;justify-content:center;
                      flex-shrink:0;border:1px solid #BFDBFE;font-size:1.2rem;">
            🔗
          </div>
          <div>
            <h3 style="font-size:1rem;font-weight:800;color:#0A0A0A;margin:0 0 2px;">
              Novo link gerado!
            </h3>
            <p style="font-size:0.78rem;color:#9CA3AF;margin:0;">
              Envie para ${esc(studentName)} ativar a conta
            </p>
          </div>
        </div>
        <div style="background:#F8F9FA;border:1px solid #EBEBEB;border-radius:12px;
                    padding:14px 16px;margin-bottom:16px;">
          <p style="font-size:0.7rem;font-weight:700;color:#9CA3AF;
                     text-transform:uppercase;letter-spacing:0.06em;margin:0 0 8px;">
            Link de primeiro acesso (válido por 7 dias)
          </p>
          <p id="newActivationUrl"
             style="font-size:0.75rem;color:#374151;word-break:break-all;
                     margin:0 0 10px;line-height:1.5;font-family:monospace;
                     background:#fff;padding:10px;border-radius:8px;
                     border:1px solid #EBEBEB;">
            ${esc(url)}
          </p>
          <button id="copyNewUrl"
            style="width:100%;padding:9px;background:#0A0A0A;color:#fff;
                   border:none;border-radius:8px;font-size:0.82rem;font-weight:700;
                   cursor:pointer;font-family:inherit;">
            📋 Copiar link
          </button>
        </div>
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;
                    padding:11px 14px;margin-bottom:16px;">
          <p style="font-size:0.78rem;color:#92400E;margin:0;line-height:1.5;">
            ⚠️ O link anterior foi invalidado. Envie apenas este novo link ao aluno.
          </p>
        </div>
        <button id="closeResendModal"
          style="width:100%;padding:12px;background:#F4F4F4;border:none;
                 border-radius:10px;font-size:0.875rem;font-weight:600;
                 color:#374151;cursor:pointer;font-family:inherit;">
          Fechar
        </button>
      </div>`;

    document.getElementById('copyNewUrl').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        const cpBtn = document.getElementById('copyNewUrl');
        if (cpBtn) {
          cpBtn.textContent      = '✓ Copiado!';
          cpBtn.style.background = '#059669';
          setTimeout(() => {
            if (document.getElementById('copyNewUrl')) {
              cpBtn.textContent      = '📋 Copiar link';
              cpBtn.style.background = '#0A0A0A';
            }
          }, 3000);
        }
      } catch {
        const urlEl = document.getElementById('newActivationUrl');
        if (urlEl) {
          const r = document.createRange();
          r.selectNodeContents(urlEl);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(r);
        }
      }
    };

    document.getElementById('closeResendModal').onclick = () =>
      overlay.classList.remove('open');

    overlay.classList.add('open');
  }

  await subscriptionGuard.init();
  await loadStudents();
};

window.__pageCleanup = function() {
  subscriptionGuard.destroy();
};