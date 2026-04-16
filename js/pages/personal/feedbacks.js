/**
 * js/pages/personal/feedbacks.js
 * Corrigido: filterToggleBtn listener adicionado aqui (era onclick inline no HTML)
 */
window.__pageInit = async function() {
  const daysMap = {
    monday:'Segunda-feira', tuesday:'Terça-feira', wednesday:'Quarta-feira',
    thursday:'Quinta-feira', friday:'Sexta-feira', saturday:'Sábado', sunday:'Domingo',
  };

  await new Promise(r => setTimeout(r, 100));

  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\//g,'&#x2F;');
  };

  let allFeedbacks = [], allStudents = [], allWorkouts = {};

  // ── Filter toggle mobile — event listener (não onclick inline) ──────
  let filtersOpen = false;

  function toggleFilters() {
    filtersOpen = !filtersOpen;
    document.getElementById('filterCollapsible')?.classList.toggle('open', filtersOpen);
    document.getElementById('filterToggleBtn')?.classList.toggle('open', filtersOpen);
  }

  document.getElementById('filterToggleBtn')?.addEventListener('click', toggleFilters);

  function applyDesktopLayout() {
    const isMobile   = window.innerWidth <= 768;
    const collapsible = document.getElementById('filterCollapsible');
    if (!collapsible) return;
    if (!isMobile) {
      collapsible.classList.add('open');
      collapsible.style.maxHeight = 'none';
      collapsible.style.overflow  = 'visible';
    } else {
      collapsible.style.maxHeight = '';
      collapsible.style.overflow  = '';
      if (!filtersOpen) collapsible.classList.remove('open');
    }
  }
  applyDesktopLayout();
  window.addEventListener('resize', applyDesktopLayout);

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await authManager.logout(); router.goToLogin();
  });

  async function loadInitialData() {
    [allStudents, allFeedbacks] = await Promise.all([
      dbManager.getMyStudents(),
      dbManager.getPersonalFeedbacks(),
    ]);
    const uniqueWorkoutIds = [...new Set(allFeedbacks.map(f => f.workoutId).filter(Boolean))];
    allWorkouts = uniqueWorkoutIds.length > 0
      ? await dbManager.getWorkoutsMap(uniqueWorkoutIds) : {};

    const filterStudent = document.getElementById('filterStudent');
    if (filterStudent) {
      allStudents.forEach(s => {
        const opt = document.createElement('option');
        opt.value       = s.uid;
        opt.textContent = s.name;
        filterStudent.appendChild(opt);
      });
    }
    renderFeedbacks();
  }

  function updateFilterDot() {
    const hasActive = !!(
      document.getElementById('filterStudent')?.value ||
      document.getElementById('filterWeek')?.value ||
      document.getElementById('filterDay')?.value ||
      document.getElementById('filterSensation')?.value
    );
    document.getElementById('filterActiveDot')?.classList.toggle('visible', hasActive);
  }

  function renderFeedbacks() {
    const container = document.getElementById('feedbacksList');
    if (!container) return;

    let filtered = [...allFeedbacks];
    const fs  = document.getElementById('filterStudent')?.value;
    const fw  = document.getElementById('filterWeek')?.value;
    const fd  = document.getElementById('filterDay')?.value;
    const fse = document.getElementById('filterSensation')?.value;
    if (fs)  filtered = filtered.filter(f => f.studentId  === fs);
    if (fw)  filtered = filtered.filter(f => f.weekIdentifier === fw);
    if (fd)  filtered = filtered.filter(f => f.dayOfWeek  === fd);
    if (fse) filtered = filtered.filter(f => f.sensation  === fse);
    updateFilterDot();

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:60px 20px;background:#FAFAFA;border-radius:16px;border:2px dashed #E5E7EB;"><p style="color:#374151;font-size:1rem;font-weight:700;margin:0 0 6px;">Nenhum feedback encontrado</p><p style="color:#9CA3AF;font-size:0.85rem;margin:0;">Os feedbacks dos alunos aparecerão aqui</p></div>`;
      return;
    }

    container.innerHTML = '';
    filtered.forEach(feedback => {
      const student     = allStudents.find(s => s.uid === feedback.studentId);
      const workout     = allWorkouts[feedback.workoutId];
      const studentName = student?.name || 'Aluno';
      const workoutName = workout?.name || 'Treino';
      const initials    = studentName.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase().replace(/[^A-Z]/g,'');

      let dateStr = '';
      if (feedback.createdAt) {
        const d = feedback.createdAt.toDate ? feedback.createdAt.toDate() : new Date(feedback.createdAt.seconds * 1000);
        dateStr = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      }

      const sc = {
        leve:   { color:'#059669', bg:'#ECFDF5', border:'#D1FAE5', label:'😌 Leve' },
        ideal:  { color:'#2563EB', bg:'#EFF6FF', border:'#BFDBFE', label:'🎯 Ideal' },
        pesado: { color:'#DC2626', bg:'#FEF2F2', border:'#FECACA', label:'🔥 Pesado' },
      }[feedback.sensation] || { color:'#6B7280', bg:'#F8F9FA', border:'#EBEBEB', label: esc(feedback.sensation) };

      const effort      = feedback.effortLevel || 0;
      const effortColor = effort >= 8 ? '#DC2626' : effort >= 5 ? '#F59E0B' : '#059669';

      const card = document.createElement('div');
      card.className = 'feedback-card';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:180px;">
            <div style="width:42px;height:42px;background:#0A0A0A;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="color:#00E676;font-size:0.85rem;font-weight:800;">${esc(initials)}</span></div>
            <div style="min-width:0;">
              <p style="font-size:1rem;font-weight:700;color:#0A0A0A;margin:0 0 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(studentName)}</p>
              <p style="font-size:0.78rem;color:#9CA3AF;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(workoutName)} · ${esc(dateStr)}</p>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span style="padding:4px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;background:#F4F4F4;color:#374151;">📅 ${esc(feedback.weekIdentifier)}</span>
            <span style="padding:4px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;background:#F4F4F4;color:#374151;">${esc(daysMap[feedback.dayOfWeek] || feedback.dayOfWeek)}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:${(feedback.hasPain && feedback.painLocation) || feedback.comment ? '14px' : '0'};">
          <div style="padding:14px 18px;background:#F8F9FA;border-radius:12px;">
            <p style="font-size:0.68rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 5px;">Esforço</p>
            <div style="display:flex;align-items:baseline;gap:4px;"><span style="font-size:1.8rem;font-weight:800;color:${effortColor};line-height:1;">${esc(effort)}</span><span style="font-size:0.75rem;color:#9CA3AF;">/10</span></div>
          </div>
          <div style="padding:14px 18px;background:${sc.bg};border:1px solid ${sc.border};border-radius:12px;">
            <p style="font-size:0.68rem;font-weight:700;color:${sc.color};opacity:0.7;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 5px;">Sensação</p>
            <p style="font-size:1rem;font-weight:700;color:${sc.color};margin:0;">${sc.label}</p>
          </div>
          <div style="padding:14px 18px;background:${feedback.hasPain ? '#FEF2F2' : '#ECFDF5'};border:1px solid ${feedback.hasPain ? '#FECACA' : '#D1FAE5'};border-radius:12px;">
            <p style="font-size:0.68rem;font-weight:700;color:${feedback.hasPain ? '#DC2626' : '#059669'};opacity:0.7;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 5px;">Dor</p>
            <p style="font-size:1rem;font-weight:700;color:${feedback.hasPain ? '#DC2626' : '#059669'};margin:0;">${feedback.hasPain ? '⚠️ Sim' : '✓ Não'}</p>
          </div>
        </div>
        ${feedback.hasPain && feedback.painLocation ? `<div style="background:#FFF1F2;border:1px solid #FECDD3;border-radius:10px;padding:11px 13px;margin-bottom:10px;"><p style="font-size:0.82rem;color:#BE123C;margin:0;font-weight:500;"><strong>Local da dor:</strong> ${esc(feedback.painLocation)}</p></div>` : ''}
        ${feedback.comment ? `<div style="background:#F8F9FA;border-radius:10px;padding:11px 13px;"><p style="font-size:0.85rem;color:#374151;margin:0;line-height:1.6;">${esc(feedback.comment)}</p></div>` : ''}`;
      container.appendChild(card);
    });
  }

  const filterIds = ['filterStudent','filterWeek','filterDay','filterSensation'];
  filterIds.forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderFeedbacks);
    document.getElementById(id)?.addEventListener('input',  renderFeedbacks);
  });

  function clearAll() {
    filterIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderFeedbacks(); updateFilterDot();
  }
  document.getElementById('clearFilters')?.addEventListener('click', clearAll);
  document.getElementById('clearFiltersMobile')?.addEventListener('click', clearAll);

  await loadInitialData();
};

window.__pageCleanup = function() {
  window.removeEventListener('resize', () => {});
};