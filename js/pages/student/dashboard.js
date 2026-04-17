/**
 * js/pages/student/dashboard.js
 * Corrigido: todos os event handlers via addEventListener (sem onclick/oninput inline)
 * - data-tab nos botões de tab
 * - data-sensation nos botões de sensação
 * - data-pain nos botões de dor
 * - effortSlider sem oninput inline
 * - toggleDone via event delegation no exercisesList
 */
window.__pageInit = async function() {
  await new Promise(r => setTimeout(r, 100));

  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\//g,'&#x2F;');
  };

  const DAYS = [
    { key:'monday',    short:'Seg', full:'Segunda-feira' },
    { key:'tuesday',   short:'Ter', full:'Terça-feira'   },
    { key:'wednesday', short:'Qua', full:'Quarta-feira'  },
    { key:'thursday',  short:'Qui', full:'Quinta-feira'  },
    { key:'friday',    short:'Sex', full:'Sexta-feira'   },
    { key:'saturday',  short:'Sáb', full:'Sábado'        },
    { key:'sunday',    short:'Dom', full:'Domingo'       },
  ];

  const MC = {
    Peito:'#EFF6FF|#2563EB', Costas:'#ECFDF5|#059669', Pernas:'#FEF3C7|#D97706',
    Ombros:'#F5F3FF|#7C3AED', Bíceps:'#FFF7ED|#EA580C', Tríceps:'#FDF2F8|#BE185D',
    Abdômen:'#ECFEFF|#0891B2', Glúteos:'#F0FDF4|#16A34A', Cardio:'#FEF2F2|#DC2626',
    'Full Body':'#F3F4F6|#6B7280',
  };
  function mStyle(m) { const p = (MC[m]||'#F3F4F6|#6B7280').split('|'); return `background:${p[0]};color:${p[1]};`; }

  function toast(msg, ms = 2400) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  }

  const todayKey = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1].key;

  let allWorkouts    = [];
  let currentWorkout = null;
  let currentDay     = null;
  let doneExercises  = new Set();
  let sensation      = null;
  let hasPain        = false;

  // ── Logout ───────────────────────────────────────────────
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await authManager.logout(); router.goToLogin();
  });

  // ── Tabs (data-tab, sem onclick inline) ──────────────────
  function showTab(tab) {
    document.getElementById('mainWorkout').style.display = tab === 'workout' ? 'block' : 'none';
    document.getElementById('mainHistory').style.display = tab === 'history' ? 'block' : 'none';
    document.getElementById('tabWorkout').classList.toggle('active', tab === 'workout');
    document.getElementById('tabHistory').classList.toggle('active', tab === 'history');
    if (tab === 'history') loadHistory();
  }

  document.getElementById('tabWorkout').addEventListener('click', () => showTab('workout'));
  document.getElementById('tabHistory').addEventListener('click', () => showTab('history'));

  // Mantém compatibilidade com código gerado dinamicamente que chama window.showTab
  window.showTab = showTab;

  // ── Esforço slider — addEventListener, sem oninput inline ─
  const effortSlider = document.getElementById('effortSlider');
  const effortDisplay = document.getElementById('effortDisplay');
  if (effortSlider && effortDisplay) {
    effortSlider.addEventListener('input', () => {
      effortDisplay.textContent = effortSlider.value;
    });
  }

  // ── Botões de sensação (data-sensation, sem onclick inline) ─
  document.addEventListener('click', (e) => {
    const sensBtn = e.target.closest('[data-sensation]');
    if (sensBtn) {
      sensation = sensBtn.dataset.sensation;
      document.querySelectorAll('[data-sensation]').forEach(b => {
        b.className = 'sensation-opt';
        if (b.dataset.sensation === sensation) {
          b.className = `sensation-opt selected-${sensation}`;
        }
      });
    }
  });

  // ── Botões de dor (data-pain, sem onclick inline) ─────────
  document.addEventListener('click', (e) => {
    const painBtn = e.target.closest('[data-pain]');
    if (!painBtn) return;
    hasPain = painBtn.dataset.pain === 'true';
    document.getElementById('painNo')?.classList.toggle('sensation-opt selected-ideal', !hasPain);
    document.getElementById('painNo')?.classList.toggle('sensation-opt', hasPain);
    document.getElementById('painYes')?.classList.toggle('sensation-opt selected-pesado', hasPain);
    document.getElementById('painYes')?.classList.toggle('sensation-opt', !hasPain);
    const wrap = document.getElementById('painLocationWrap');
    if (wrap) wrap.style.display = hasPain ? 'block' : 'none';
  });

  // ── Toggle exercício feito — event delegation ─────────────
  // O exercisesList é recriado a cada renderização, então usamos delegation
  // O JS expõe toggleDone para compatibilidade com o HTML gerado em renderExercises()
  function toggleDone(idx) {
    if (doneExercises.has(idx)) {
      doneExercises.delete(idx);
      document.getElementById(`ex-${idx}`)?.classList.remove('done');
      document.getElementById(`check-${idx}`)?.classList.remove('checked');
      const icon = document.getElementById(`check-icon-${idx}`);
      if (icon) icon.style.display = 'none';
    } else {
      doneExercises.add(idx);
      document.getElementById(`ex-${idx}`)?.classList.add('done');
      document.getElementById(`check-${idx}`)?.classList.add('checked');
      const icon = document.getElementById(`check-icon-${idx}`);
      if (icon) icon.style.display = 'block';
    }
    updateProgress();
  }
  window.toggleDone = toggleDone;

  // ── Carregar treinos ──────────────────────────────────────
  try { allWorkouts = await dbManager.getStudentWorkouts() || []; }
  catch { allWorkouts = []; }

  if (allWorkouts.length === 0) {
    document.getElementById('pageTitle').textContent = 'Sem rotina';
    document.getElementById('exercisesList').innerHTML = `
      <div style="text-align:center;padding:60px 20px;background:#fff;border-radius:16px;border:2px dashed #E5E7EB;">
        <p style="font-size:1rem;font-weight:700;color:#374151;margin:0 0 6px;">Nenhuma rotina atribuída</p>
        <p style="font-size:0.85rem;color:#9CA3AF;margin:0;">Seu personal ainda não criou uma rotina para você</p>
      </div>`;
    return;
  }

  if (allWorkouts.length > 1) {
    const sel   = document.getElementById('workoutSelector');
    const pills = document.getElementById('workoutPills');
    if (sel) sel.style.display = 'block';
    allWorkouts.forEach((w, i) => {
      const btn = document.createElement('button');
      btn.className = 'workout-pill' + (i === 0 ? ' active' : '');
      btn.textContent = w.name || `Rotina ${i+1}`;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.workout-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        selectWorkout(w);
      });
      pills?.appendChild(btn);
    });
  }

  selectWorkout(allWorkouts[0]);

  function selectWorkout(w) {
    currentWorkout = w;
    doneExercises.clear();
    document.getElementById('pageTitle').textContent = w.name || 'Meu Treino';
    renderDayTabs();
    const todayHas = w.days?.[todayKey]?.length > 0;
    const firstDay = DAYS.find(d => w.days?.[d.key]?.length > 0);
    selectDay(todayHas ? todayKey : (firstDay ? firstDay.key : DAYS[0].key));
  }

  function renderDayTabs() {
    const tabs = document.getElementById('dayTabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    DAYS.forEach(d => {
      const hasEx   = currentWorkout.days?.[d.key]?.length > 0;
      const btn     = document.createElement('button');
      btn.className = 'day-tab' + (d.key === currentDay ? ' active' : '') + (hasEx ? ' has-workout' : '');
      btn.textContent = d.short;
      if (hasEx) { const dot = document.createElement('span'); dot.className = 'day-tab-dot'; btn.appendChild(dot); }
      btn.addEventListener('click', () => selectDay(d.key));
      if (!hasEx) btn.style.opacity = '0.45';
      tabs.appendChild(btn);
    });
  }

  function selectDay(dayKey) {
    currentDay = dayKey;
    doneExercises.clear();
    renderDayTabs();
    renderExercises();
    updateProgress();
  }

  function renderExercises() {
    const list       = document.getElementById('exercisesList');
    const exs        = currentWorkout.days?.[currentDay] || [];
    const dayName    = DAYS.find(d => d.key === currentDay)?.full || '';
    const feedbackWrap = document.getElementById('feedbackBtnWrap');
    const progressCard = document.getElementById('progressCard');

    if (exs.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:48px 20px;background:#fff;border-radius:16px;border:2px dashed #E5E7EB;"><p style="font-size:1rem;font-weight:700;color:#374151;margin:0 0 6px;">Dia de descanso 😴</p><p style="font-size:0.85rem;color:#9CA3AF;margin:0;">Nenhum treino para ${esc(dayName)}</p></div>`;
      if (feedbackWrap) feedbackWrap.style.display = 'none';
      if (progressCard) progressCard.style.display = 'none';
      return;
    }

    if (progressCard) progressCard.style.display = 'block';
    if (feedbackWrap) feedbackWrap.style.display = 'block';

    list.innerHTML = '';
    const frag = document.createDocumentFragment();

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;';
    header.innerHTML = `
      <div>
        <p style="font-size:0.72rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.07em;margin:0 0 2px;">TREINO DO DIA</p>
        <h2 style="font-size:1.1rem;font-weight:800;color:#0A0A0A;margin:0;">${esc(dayName)}</h2>
      </div>
      <span style="background:#F4F4F4;border-radius:8px;padding:4px 10px;font-size:0.75rem;font-weight:700;color:#374151;">${esc(exs.length)} exerc.</span>`;
    frag.appendChild(header);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    exs.forEach((ex, idx) => {
      const card = document.createElement('div');
      card.className = 'ex-card';
      card.id = `ex-${idx}`;
      // check-btn usa data-idx em vez de onclick="toggleDone(N)" inline
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;">
          <div style="flex:1;min-width:0;">
            <p class="ex-card-name">${esc(ex.exerciseName || ex.name || '?')}</p>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <span class="ex-meta-pill" style="background:#111827;color:#fff;">${esc(ex.sets||3)}×${esc(ex.reps||12)}</span>
              ${ex.muscleGroup ? `<span class="ex-meta-pill" style="${mStyle(ex.muscleGroup)}">${esc(ex.muscleGroup)}</span>` : ''}
              ${ex.rest ? `<span class="ex-meta-pill" style="background:#F3F4F6;color:#6B7280;">⏱ ${esc(ex.rest)}</span>` : ''}
            </div>
            ${ex.obs ? `<p style="font-size:0.78rem;color:#6B7280;margin:8px 0 0;font-style:italic;">${esc(ex.obs)}</p>` : ''}
          </div>
          <button class="check-btn" id="check-${idx}" data-idx="${idx}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" style="display:none;" id="check-icon-${idx}"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>`;
      grid.appendChild(card);
    });
    frag.appendChild(grid);
    list.appendChild(frag);

    // Event delegation para os check-btns (sem onclick inline)
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.check-btn[data-idx]');
      if (btn) toggleDone(parseInt(btn.dataset.idx, 10));
    }, { once: false });
  }

  function updateProgress() {
    const exs   = currentWorkout.days?.[currentDay] || [];
    const total = exs.length;
    const done  = doneExercises.size;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    const ptEl  = document.getElementById('progressText');
    const pfEl  = document.getElementById('progressFill');
    if (ptEl) ptEl.textContent      = `${done}/${total} exercícios`;
    if (pfEl) pfEl.style.width      = `${pct}%`;
  }

  // ── Feedback modal ────────────────────────────────────────
  document.getElementById('openFeedbackBtn')?.addEventListener('click', () => {
    sensation = null; hasPain = false;
    document.getElementById('feedbackComment').value = '';
    document.getElementById('painLocation').value    = '';
    document.getElementById('effortSlider').value    = 7;
    document.getElementById('effortDisplay').textContent = '7';
    document.getElementById('painLocationWrap').style.display = 'none';
    document.querySelectorAll('[data-sensation]').forEach(b => b.className = 'sensation-opt');
    document.getElementById('painNo')?.classList.add('sensation-opt');
    document.getElementById('painYes')?.classList.add('sensation-opt');
    const dayName = DAYS.find(d => d.key === currentDay)?.full || '';
    document.getElementById('feedbackModalSub').textContent = `${currentWorkout.name} · ${dayName}`;
    document.getElementById('feedbackModal').classList.add('open');
  });

  document.getElementById('closeFeedbackModal')?.addEventListener('click', () => document.getElementById('feedbackModal').classList.remove('open'));
  document.getElementById('cancelFeedback')?.addEventListener('click',    () => document.getElementById('feedbackModal').classList.remove('open'));
  document.getElementById('feedbackModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('feedbackModal')) document.getElementById('feedbackModal').classList.remove('open');
  });

  document.getElementById('submitFeedback')?.addEventListener('click', async () => {
    if (!sensation) return toast('⚠ Selecione a sensação do treino');
    const effort       = parseInt(document.getElementById('effortSlider').value);
    const comment      = document.getElementById('feedbackComment').value.trim();
    const painLocation = hasPain ? document.getElementById('painLocation').value.trim() : '';
    const btn = document.getElementById('submitFeedback');
    btn.textContent = 'Enviando...'; btn.disabled = true;
    try {
      const now        = new Date();
      const weekNum    = Math.ceil((((now - new Date(now.getFullYear(),0,1))/86400000) + new Date(now.getFullYear(),0,1).getDay()+1)/7);
      const weekId     = `${now.getFullYear()}-${weekNum.toString().padStart(2,'0')}`;
      await dbManager.submitFeedback({ workoutId: currentWorkout.id, studentId: authManager.getCurrentUser()?.uid, dayOfWeek: currentDay, weekIdentifier: weekId, sensation, effortLevel: effort, hasPain, painLocation, comment });
      document.getElementById('feedbackModal').classList.remove('open');
      toast('✓ Feedback enviado!', 2800);
    } catch { toast('Erro ao enviar. Tente novamente.'); }
    btn.textContent = 'Enviar Feedback'; btn.disabled = false;
  });

  async function loadHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = `<div style="text-align:center;padding:48px;"><div class="spinner" style="margin:0 auto 16px;"></div><p style="color:#9CA3AF;">Carregando...</p></div>`;
    try {
      const feedbacks = await dbManager.getStudentFeedbacks() || [];
      if (feedbacks.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:48px;background:#fff;border-radius:16px;border:2px dashed #E5E7EB;"><p style="font-size:1rem;font-weight:700;color:#374151;margin:0 0 6px;">Sem histórico ainda</p></div>`;
        return;
      }
      const sensationLabels = { leve:'😌 Leve', ideal:'🎯 Ideal', pesado:'🔥 Pesado' };
      list.innerHTML = '';
      feedbacks.forEach(f => {
        let dateStr = '';
        if (f.createdAt) {
          const d = f.createdAt.toDate ? f.createdAt.toDate() : new Date(f.createdAt.seconds * 1000);
          dateStr = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
        }
        const dayName = DAYS.find(d => d.key === f.dayOfWeek)?.full || esc(f.dayOfWeek);
        const item    = document.createElement('div');
        item.className = 'ex-card';
        item.style.marginBottom = '10px';
        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;">
            <div><p style="font-size:0.9rem;font-weight:700;color:#0A0A0A;margin:0 0 3px;">${esc(dayName)}</p><p style="font-size:0.75rem;color:#9CA3AF;margin:0;">${esc(dateStr)} · Semana ${esc(f.weekIdentifier)}</p></div>
            <span style="font-size:0.78rem;font-weight:700;background:#F4F4F4;padding:4px 10px;border-radius:8px;">${esc(sensationLabels[f.sensation] || f.sensation)}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span class="ex-meta-pill" style="background:#111827;color:#fff;">Esforço ${esc(f.effortLevel)}/10</span>
            ${f.hasPain ? `<span class="ex-meta-pill" style="background:#FEF2F2;color:#DC2626;">⚠ Dor</span>` : '<span class="ex-meta-pill" style="background:#ECFDF5;color:#059669;">✓ Sem dor</span>'}
          </div>
          ${f.comment ? `<p style="font-size:0.82rem;color:#6B7280;margin:8px 0 0;line-height:1.5;font-style:italic;">"${esc(f.comment)}"</p>` : ''}`;
        list.appendChild(item);
      });
    } catch { list.innerHTML = `<p style="color:#DC2626;">Erro ao carregar histórico.</p>`; }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('feedbackModal')?.classList.remove('open');
  });
};

window.__pageCleanup = function() {
  delete window.showTab;
  delete window.toggleDone;
};