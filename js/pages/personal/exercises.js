/**
 * js/pages/personal/exercises.js
 * Migrado de script inline em pages/personal/exercises.html
 */
window.__pageInit = async function() {
  await new Promise(r => setTimeout(r, 80));

  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\//g,'&#x2F;');
  };

  const currentUid = authManager.getCurrentUser()?.uid || '';

  const groupColors = {
    'Peito':'#FEF3C7','Costas':'#DBEAFE','Pernas':'#D1FAE5','Ombros':'#EDE9FE',
    'Bíceps':'#FCE7F3','Tríceps':'#FEE2E2','Abdômen':'#FFF7ED','Glúteos':'#F0FDF4',
    'Panturrilhas':'#F0F9FF','Cardio':'#FEF9C3','Funcional':'#F5F3FF','Full Body':'#F3F4F6',
    'Quadríceps':'#ECFDF5','Posterior':'#FDF2F8','Lombar':'#E0F2FE',
  };
  const groupTextColors = {
    'Peito':'#92400E','Costas':'#1E40AF','Pernas':'#065F46','Ombros':'#5B21B6',
    'Bíceps':'#9D174D','Tríceps':'#991B1B','Abdômen':'#9A3412','Glúteos':'#14532D',
    'Panturrilhas':'#0C4A6E','Cardio':'#713F12','Funcional':'#4C1D95','Full Body':'#374151',
    'Quadríceps':'#065F46','Posterior':'#831843','Lombar':'#0E4270',
  };

  let allExercises  = [];
  let currentFilter = 'all';

  document.getElementById('logoutBtn').onclick = async () => {
    await authManager.logout(); router.goToLogin();
  };

  // ── Modal ──────────────────────────────────────────────────
  const modal = document.getElementById('addExerciseModal');
  document.getElementById('openAddExerciseModal').onclick = () => {
    modal.style.display = 'flex';
    document.getElementById('exName').focus();
  };
  document.getElementById('closeAddModal').onclick  = closeModal;
  document.getElementById('cancelAddExercise').onclick = closeModal;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  function closeModal() {
    modal.style.display = 'none';
    ['exName','exVideo','exDesc'].forEach(id => { document.getElementById(id).value = ''; });
    ['muscle1Group','muscle2Group','muscle3Group'].forEach(id => { document.getElementById(id).value = ''; });
    ['muscle1Pct','muscle2Pct','muscle3Pct'].forEach(id => { document.getElementById(id).value = ''; });
    updatePctTotal();
    document.getElementById('addExerciseError').style.display = 'none';
  }

  function updatePctTotal() {
    const p1 = parseInt(document.getElementById('muscle1Pct').value) || 0;
    const p2 = parseInt(document.getElementById('muscle2Pct').value) || 0;
    const p3 = parseInt(document.getElementById('muscle3Pct').value) || 0;
    const total = p1 + p2 + p3;
    const el = document.getElementById('pctTotal');
    el.textContent = `${total}% / 100%`;
    el.className = 'pct-display ' + (total === 100 ? 'pct-ok' : total > 100 ? 'pct-over' : 'pct-under');
    return total;
  }
  ['muscle1Pct','muscle2Pct','muscle3Pct'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePctTotal);
  });

  document.getElementById('saveExerciseBtn').onclick = async () => {
    const name   = document.getElementById('exName').value.trim();
    const video  = document.getElementById('exVideo').value.trim();
    const desc   = document.getElementById('exDesc').value.trim();
    const errDiv = document.getElementById('addExerciseError');
    errDiv.style.display = 'none';
    if (!name) { errDiv.textContent = 'Nome é obrigatório.'; return errDiv.style.display = 'block'; }
    const g1 = document.getElementById('muscle1Group').value;
    const p1 = parseInt(document.getElementById('muscle1Pct').value) || 0;
    const g2 = document.getElementById('muscle2Group').value;
    const p2 = parseInt(document.getElementById('muscle2Pct').value) || 0;
    const g3 = document.getElementById('muscle3Group').value;
    const p3 = parseInt(document.getElementById('muscle3Pct').value) || 0;
    if (!g1 || !p1) { errDiv.textContent = 'Selecione o grupo primário e sua porcentagem.'; return errDiv.style.display = 'block'; }
    const total = updatePctTotal();
    if (total !== 100) { errDiv.textContent = `A soma deve ser 100%. Atual: ${total}%.`; return errDiv.style.display = 'block'; }
    const muscles = [{ group: g1, percentage: p1 }];
    if (g2 && p2) muscles.push({ group: g2, percentage: p2 });
    if (g3 && p3) muscles.push({ group: g3, percentage: p3 });
    const btn = document.getElementById('saveExerciseBtn');
    btn.textContent = 'Salvando...'; btn.disabled = true;
    try {
      const result = await dbManager.addExercise({ name, muscleGroup: g1, muscles, videoUrl: video, description: desc });
      if (result && result.success !== false) { closeModal(); await loadExercises(); }
      else { errDiv.textContent = result?.error || 'Erro ao salvar.'; errDiv.style.display = 'block'; }
    } catch { errDiv.textContent = 'Erro inesperado.'; errDiv.style.display = 'block'; }
    btn.textContent = 'Salvar Exercício'; btn.disabled = false;
  };

  // ── Filtros ────────────────────────────────────────────────
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.group;
      renderExercises();
    });
  });
  document.getElementById('searchInput').addEventListener('input', renderExercises);

  // ── Render ──────────────────────────────────────────────────
  function renderExercises() {
    const search   = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const filtered = allExercises.filter(ex => {
      const isOwn = ex.personalId === currentUid;
      if (currentFilter === 'meu' && !isOwn) return false;
      if (currentFilter !== 'all' && currentFilter !== 'meu') {
        const inMuscles = (ex.muscles || []).some(m => m.group === currentFilter);
        if (!inMuscles && ex.muscleGroup !== currentFilter) return false;
      }
      return !search
        || (ex.name || '').toLowerCase().includes(search)
        || (ex.muscleGroup || '').toLowerCase().includes(search)
        || (ex.muscles || []).some(m => m.group.toLowerCase().includes(search));
    });

    const grid = document.getElementById('exercisesGrid');
    if (filtered.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;padding:48px 32px;background:#FAFAFA;border-radius:16px;border:2px dashed #E5E7EB;text-align:center;"><p style="font-size:1rem;font-weight:600;color:#374151;margin:0 0 6px;">Nenhum exercício encontrado</p><p style="font-size:0.85rem;color:#9CA3AF;margin:0;">Tente outro filtro ou adicione um novo exercício</p></div>`;
      return;
    }

    grid.innerHTML = '';
    filtered.forEach(ex => {
      const isOwn = ex.personalId === currentUid;
      const mg    = ex.muscleGroup || '';
      const bg    = groupColors[mg]      || '#F4F4F4';
      const tc    = groupTextColors[mg]  || '#374151';

      const musclesBadges = (ex.muscles && ex.muscles.length > 0)
        ? ex.muscles.map(m => {
            const mBg = groupColors[m.group]     || '#F4F4F4';
            const mTc = groupTextColors[m.group] || '#374151';
            return `<span class="muscle-badge" style="background:${mBg};color:${mTc};">${esc(m.group)} ${esc(m.percentage)}%</span>`;
          }).join('')
        : `<span class="muscle-badge" style="background:${bg};color:${tc};">${esc(mg) || '—'}</span>`;

      const videoHtml = ex.videoUrl
        ? `<a href="${esc(ex.videoUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;font-weight:600;color:#6B7280;text-decoration:none;background:#F4F4F4;padding:5px 10px;border-radius:7px;">▶ Ver vídeo</a>`
        : '';

      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.innerHTML = `
        <div style="padding:20px 20px 16px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;">
            <h3 style="font-size:0.95rem;font-weight:700;color:#0A0A0A;margin:0;line-height:1.4;flex:1;">${esc(ex.name)}</h3>
            ${isOwn
              ? '<span style="font-size:0.62rem;font-weight:700;background:rgba(0,230,118,0.12);color:#00A843;border:1px solid rgba(0,230,118,0.25);border-radius:6px;padding:2px 7px;flex-shrink:0;">Meu</span>'
              : '<span style="font-size:0.62rem;font-weight:700;background:#F4F4F4;color:#6B7280;border-radius:6px;padding:2px 7px;flex-shrink:0;">Pronto</span>'}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:${ex.description || ex.videoUrl ? '12px' : '0'};">${musclesBadges}</div>
          ${ex.description ? `<p style="font-size:0.8rem;color:#6B7280;margin:0 0 10px;line-height:1.5;">${esc(ex.description)}</p>` : ''}
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${videoHtml}</div>
        </div>`;
      grid.appendChild(card);
    });
  }

  async function loadExercises() {
    const grid = document.getElementById('exercisesGrid');
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:64px 20px;"><div class="spinner" style="margin:0 auto 16px;"></div><p style="color:#9CA3AF;font-size:0.875rem;margin:0;">Carregando...</p></div>`;
    try {
      allExercises = await dbManager.getExercises() || [];
      renderExercises();
    } catch {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;"><p style="color:#BE123C;">Erro ao carregar exercícios.</p></div>`;
    }
  }

  await loadExercises();
};
