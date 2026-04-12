/**
 * js/pages/personal/student-details.js
 * Migrado de script inline em pages/personal/student-details.html
 */
window.__pageInit = async function(params) {
  const DAYS_PT    = { monday:'Segunda', tuesday:'Terça', wednesday:'Quarta', thursday:'Quinta', friday:'Sexta', saturday:'Sábado', sunday:'Domingo' };
  const DAYS_ORDER = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\//g,'&#x2F;');
  };

  // Obter studentId dos parâmetros de rota ou hash
  const studentId = params?.id || window.routeParams?.id ||
    (() => {
      const parts = (window.location.hash || '').replace('#','').split('/').filter(Boolean);
      const idx   = parts.indexOf('student');
      return (idx !== -1 && parts[idx + 1]) ? parts[idx + 1] : (sessionStorage.getItem('currentStudentId') || '');
    })();

  document.getElementById('logoutBtn').onclick = async () => {
    await authManager.logout(); router.goToLogin();
  };

  document.getElementById('createWorkoutBtn').onclick = () => {
    if (studentId) sessionStorage.setItem('preSelectedStudent', studentId);
    router.goTo('/personal/create-workout');
  };

  async function loadStudent() {
    if (!studentId) return;
    try {
      const student  = await dbManager.getUserData(studentId);
      if (!student) return;
      const initials = (student.name || 'A').split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
      document.getElementById('avatarInitials').textContent = initials;
      document.getElementById('studentName').textContent    = student.name  || '—';
      document.getElementById('studentEmail').textContent   = student.email || '';
    } catch (e) { console.error('Erro ao carregar aluno:', e); }
  }

  async function loadWorkouts() {
    const list = document.getElementById('workoutsList');
    if (!studentId) {
      list.innerHTML = `<div style="text-align:center;padding:48px;color:#BE123C;">ID do aluno não encontrado.</div>`;
      return;
    }

    try {
      const workouts = await dbManager.getStudentWorkouts(studentId) || [];
      document.getElementById('workoutsCount').textContent = workouts.length;

      if (workouts.length === 0) {
        list.innerHTML = `
          <div style="padding:48px 32px;background:#FAFAFA;border-radius:16px;border:2px dashed #E5E7EB;text-align:center;">
            <p style="font-size:1rem;font-weight:600;color:#374151;margin:0 0 6px;">Nenhum treino cadastrado</p>
            <p style="font-size:0.85rem;color:#9CA3AF;margin:0 0 18px;">Crie o primeiro treino para este aluno</p>
            <button onclick="document.getElementById('createWorkoutBtn').click()" class="nav-link-accent" style="margin:0 auto;">+ Criar Treino</button>
          </div>`;
        return;
      }

      list.innerHTML = '';
      workouts.forEach(w => {
        const days        = w.days || {};
        const activeDays  = DAYS_ORDER.filter(d => days[d]?.length > 0);
        const totalEx     = activeDays.reduce((s, d) => s + (days[d]?.length || 0), 0);

        const daysPreviewHtml = activeDays.map(d => {
          const exList = days[d] || [];
          return `
            <div style="flex:1;min-width:140px;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                <span style="background:#F4F4F4;border-radius:6px;font-size:0.72rem;font-weight:700;padding:4px 10px;">${esc(DAYS_PT[d])}</span>
                <span style="font-size:0.7rem;color:#9CA3AF;">${esc(exList.length)} ex.</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:3px;">
                ${exList.slice(0,3).map(ex => `
                  <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #F4F4F4;">
                    <span style="width:5px;height:5px;border-radius:50%;background:#00E676;flex-shrink:0;"></span>
                    <span style="font-size:0.78rem;color:#374151;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ex.exerciseName || ex.name || '—')}</span>
                    <span style="font-size:0.7rem;color:#9CA3AF;margin-left:auto;flex-shrink:0;">${esc(ex.sets||'?')}×${esc(ex.reps||'?')}</span>
                  </div>`).join('')}
                ${exList.length > 3 ? `<span style="font-size:0.72rem;color:#9CA3AF;padding-top:2px;">+${esc(exList.length - 3)} mais</span>` : ''}
              </div>
            </div>`;
        }).join('');

        const card = document.createElement('div');
        card.className = 'workout-card';
        card.innerHTML = `
          <div style="padding:20px 22px 16px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:12px;">
              <div style="flex:1;min-width:0;">
                <h3 style="font-size:1rem;font-weight:700;color:#0A0A0A;margin:0 0 6px;line-height:1.3;">${esc(w.name)}</h3>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                  <span style="font-size:0.75rem;color:#6B7280;">${esc(activeDays.length)} dia(s) ativo(s)</span>
                  <span style="color:#D1D5DB;font-size:0.7rem;">•</span>
                  <span style="font-size:0.75rem;color:#6B7280;">${esc(totalEx)} exercício(s)</span>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-shrink:0;">
                <button onclick="router.goToVolumeAnalysis('${esc(studentId)}')" style="padding:7px 14px;background:rgba(0,230,118,0.12);border:1px solid rgba(0,230,118,0.3);border-radius:8px;font-size:0.78rem;font-weight:600;color:#00A843;cursor:pointer;font-family:inherit;">📊 Volume</button>
                <button onclick="editWorkout('${esc(w.id)}')" style="padding:7px 14px;background:#F4F4F4;border:none;border-radius:8px;font-size:0.78rem;font-weight:600;color:#374151;cursor:pointer;font-family:inherit;">✏️ Editar</button>
                <button onclick="deleteWorkout('${esc(w.id)}','${(w.name||'').replace(/'/g,"\\'")}')" style="padding:7px 14px;background:#FEF2F2;border:none;border-radius:8px;font-size:0.78rem;font-weight:600;color:#DC2626;cursor:pointer;font-family:inherit;">🗑️ Remover</button>
              </div>
            </div>
            ${activeDays.length > 0
              ? `<div style="border-top:1px solid #F4F4F4;padding-top:14px;display:flex;flex-wrap:wrap;gap:16px;">${daysPreviewHtml}</div>`
              : `<p style="color:#9CA3AF;font-size:0.82rem;margin:0;">Nenhum exercício adicionado ainda.</p>`}
          </div>`;
        list.appendChild(card);
      });

    } catch (e) {
      list.innerHTML = `<div style="text-align:center;padding:48px;color:#BE123C;">Erro: ${esc(e.message)}</div>`;
    }
  }

  window.editWorkout = function(workoutId) {
    sessionStorage.setItem('editWorkoutId', workoutId);
    router.goTo('/personal/create-workout');
  };

  window.deleteWorkout = async function(workoutId, workoutName) {
    if (!confirm(`Remover o treino "${workoutName}"? Esta ação não pode ser desfeita.`)) return;
    try { await dbManager.deleteWorkout(workoutId); await loadWorkouts(); }
    catch (e) { alert('Erro ao remover: ' + e.message); }
  };

  await Promise.all([loadStudent(), loadWorkouts()]);
};
