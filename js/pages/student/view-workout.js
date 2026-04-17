/**
 * js/pages/student/view-workout.js
 *
 * CORREÇÕES CSP:
 * - renderTabs(): botões de dia usam data-day em vez de onclick="switchDay(...)"
 * - renderDay(): botão "Marcar como feito" usa data-day + data-idx em vez de onclick="toggleCheck(...)"
 * - renderFbCta(): botão "Enviar Feedback" usa data-day em vez de onclick="openFeedback(...)"
 * - Event delegation no mainContent para capturar todos esses cliques
 * - effortRange: addEventListener('input') em vez de oninput inline no HTML
 */
window.__pageInit = async function() {
  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\//g,'&#x2F;');
  };

  function sanitizeVideoUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const u = new URL(url.trim());
      if (u.protocol !== 'https:') return '';
      const allowed = ['youtube.com','www.youtube.com','youtu.be','vimeo.com','player.vimeo.com'];
      return allowed.includes(u.hostname) ? url.trim() : '';
    } catch { return ''; }
  }

  const DAYS_ORDER = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const DAYS_PT    = { monday:'Segunda',tuesday:'Terça',wednesday:'Quarta',thursday:'Quinta',friday:'Sexta',saturday:'Sábado',sunday:'Domingo' };
  const DAYS_SHORT = { monday:'SEG',tuesday:'TER',wednesday:'QUA',thursday:'QUI',friday:'SEX',saturday:'SÁB',sunday:'DOM' };
  const jsToKey    = { 0:'sunday',1:'monday',2:'tuesday',3:'wednesday',4:'thursday',5:'friday',6:'saturday' };
  const todayKey   = jsToKey[new Date().getDay()];

  let workout          = null;
  let currentDay       = null;
  let checkedExercises = {};
  let currentFbDay     = null;

  document.getElementById('logoutBtn').onclick = async () => { await authManager.logout(); router.goToLogin(); };

  function getWorkoutId() {
    const id    = sessionStorage.getItem('viewWorkoutId');
    if (id) return id;
    const parts = (window.location.hash || '').replace('#','').split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  function getInitialDay(days) {
    const fromDash = sessionStorage.getItem('viewWorkoutDay');
    if (fromDash && days[fromDash]?.length > 0) return fromDash;
    if (days[todayKey]?.length > 0) return todayKey;
    return DAYS_ORDER.find(d => days[d]?.length > 0) || DAYS_ORDER[0];
  }

  function updateSliderGradient(input) {
    const pct = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.background = `linear-gradient(to right, #00E676 ${pct}%, #EBEBEB ${pct}%)`;
  }

  function renderPage() {
    const main      = document.getElementById('mainContent');
    const days      = workout.days || {};
    const activeDays = DAYS_ORDER.filter(d => days[d]?.length > 0);
    DAYS_ORDER.forEach(d => { if (!checkedExercises[d]) checkedExercises[d] = new Set(); });

    main.innerHTML = `
      <div style="margin-bottom:28px;">
        <p style="color:#9CA3AF;font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 5px;">SEU TREINO</p>
        <h1 style="font-size:1.7rem;font-weight:800;color:#0A0A0A;margin:0 0 6px;letter-spacing:-0.03em;">${esc(workout.name)}</h1>
        <p style="font-size:0.85rem;color:#6B7280;margin:0;">${esc(String(activeDays.length))} dias ativos na semana</p>
      </div>
      <div class="day-tabs" style="margin-bottom:24px;" id="dayTabs"></div>
      <div id="dayProgress" style="margin-bottom:20px;"></div>
      <div id="dayExercises"></div>
      <div id="fbCta" style="margin-top:28px;"></div>`;

    // Event delegation no mainContent para switchDay, toggleCheck, openFeedback
    main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action  = btn.dataset.action;
      const dayKey  = btn.dataset.day;
      const idx     = btn.dataset.idx !== undefined ? parseInt(btn.dataset.idx, 10) : undefined;

      if (action === 'switch-day' && dayKey)         switchDay(dayKey);
      else if (action === 'toggle-check' && dayKey)  toggleCheck(dayKey, idx);
      else if (action === 'open-feedback' && dayKey) openFeedback(dayKey);
    });

    renderTabs(activeDays, days);
    renderDay(currentDay, days);
  }

  function renderTabs(activeDays, days) {
    const tabsEl = document.getElementById('dayTabs');
    if (!tabsEl) return;
    // Botões usam data-action="switch-day" data-day="..." em vez de onclick inline
    tabsEl.innerHTML = DAYS_ORDER.map(d => {
      const hasWorkout = days[d]?.length > 0;
      const isToday    = d === todayKey;
      const isActive   = d === currentDay;
      let cls = 'day-tab';
      if (!hasWorkout) cls += ' rest';
      if (isToday)     cls += ' today';
      if (isActive)    cls += ' active';
      if (hasWorkout) {
        return `<button class="${cls}" data-action="switch-day" data-day="${d}">
          ${DAYS_SHORT[d]}${isToday ? '<span style="font-size:0.6rem;display:block;margin-top:1px;">hoje</span>' : ''}
        </button>`;
      }
      return `<button class="${cls}" disabled>
        ${DAYS_SHORT[d]}
      </button>`;
    }).join('');
  }

  function renderDay(dayKey, days) {
    const exercises = days?.[dayKey] || [];
    const checked   = checkedExercises[dayKey] || new Set();
    const total     = exercises.length;
    const done      = checked.size;
    const pct       = total > 0 ? Math.round((done / total) * 100) : 0;

    const progressEl = document.getElementById('dayProgress');
    if (progressEl) {
      progressEl.innerHTML = total > 0 ? `
        <div style="background:#fff;border:1px solid #EBEBEB;border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:14px;">
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;margin-bottom:7px;">
              <span style="font-size:0.78rem;font-weight:700;color:#374151;">${esc(DAYS_PT[dayKey])}</span>
              <span style="font-size:0.78rem;font-weight:700;color:${pct===100?'#059669':'#6B7280'};">${esc(String(done))}/${esc(String(total))} exercícios</span>
            </div>
            <div style="background:#E5E7EB;border-radius:999px;height:6px;overflow:hidden;"><div style="height:100%;background:#00E676;border-radius:999px;width:${pct}%;transition:width 0.4s;"></div></div>
          </div>
          ${pct === 100 ? '<span style="font-size:1.4rem;">🎉</span>' : ''}
        </div>` : '';
    }

    const listEl = document.getElementById('dayExercises');
    if (!listEl) return;

    if (exercises.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:40px 20px;background:#fff;border-radius:16px;border:2px dashed #E5E7EB;"><p style="font-size:1rem;font-weight:600;color:#374151;margin:0 0 4px;">Dia de descanso</p><p style="font-size:0.85rem;color:#9CA3AF;margin:0;">Nenhum exercício para hoje</p></div>`;
      const ctaEl = document.getElementById('fbCta');
      if (ctaEl) ctaEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    exercises.forEach((ex, idx) => {
      const isDone   = checked.has(idx);
      const exName   = esc(ex.exerciseName || ex.name || 'Exercício');
      const exMuscle = esc(ex.muscleGroup  || ex.muscle || '');
      const exSets   = esc(String(ex.sets  || '—'));
      const exReps   = esc(String(ex.reps  || '—'));
      const exRest   = esc(String(ex.rest  || ''));
      const exObs    = esc(ex.obs          || ex.notes || '');
      const exVideo  = sanitizeVideoUrl(ex.videoUrl || ex.video || '');

      const cardEl = document.createElement('div');
      cardEl.className = `ex-card${isDone ? ' done' : ''}`;
      cardEl.id        = `ex-card-${idx}`;
      cardEl.style.marginBottom = '12px';
      // Botão usa data-action + data-day + data-idx em vez de onclick inline
      cardEl.innerHTML = `
        <div class="ex-card-body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
              <span style="width:30px;height:30px;border-radius:8px;background:${isDone?'#00E676':'#0A0A0A'};color:${isDone?'#0A0A0A':'#fff'};display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:800;flex-shrink:0;">${isDone ? '✓' : esc(String(idx+1))}</span>
              <h3 style="font-size:0.95rem;font-weight:700;color:#0A0A0A;margin:0;line-height:1.3;">${exName}</h3>
            </div>
            ${exMuscle ? `<span class="ex-chip" style="background:#F4F4F4;color:#374151;flex-shrink:0;display:inline-flex;align-items:center;padding:5px 12px;border-radius:8px;font-size:0.75rem;font-weight:700;">${exMuscle}</span>` : ''}
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:${exVideo||exObs?'14px':'12px'};">
            <span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:8px;font-size:0.75rem;font-weight:700;background:#0A0A0A;color:#fff;">${exSets} séries × ${exReps}</span>
            ${exRest ? `<span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:8px;font-size:0.75rem;font-weight:700;background:#F4F4F4;color:#6B7280;">⏱ ${exRest}</span>` : ''}
          </div>
          ${exObs ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:9px 12px;margin-bottom:12px;display:flex;gap:7px;align-items:flex-start;"><span style="font-size:0.85rem;flex-shrink:0;">💡</span><p style="font-size:0.8rem;color:#92400E;margin:0;line-height:1.5;">${exObs}</p></div>` : ''}
          ${exVideo ? `<div style="position:relative;width:100%;padding-bottom:56.25%;border-radius:10px;overflow:hidden;background:#000;margin-top:14px;"><iframe src="${exVideo}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" style="position:absolute;inset:0;width:100%;height:100%;border:none;"></iframe></div>` : ''}
          <div style="margin-top:14px;">
            <button class="${isDone ? 'check-btn check-btn-done' : 'check-btn check-btn-todo'}"
              data-action="toggle-check" data-day="${dayKey}" data-idx="${idx}"
              style="width:100%;padding:12px;border:none;border-radius:10px;font-size:0.875rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.25s;font-family:inherit;${isDone?'background:#D1FAE5;color:#065F46;':'background:#0A0A0A;color:#fff;'}">
              ${isDone ? '✓ Concluído' : '◷ Marcar como feito'}
            </button>
          </div>
        </div>`;
      frag.appendChild(cardEl);
    });
    listEl.appendChild(frag);
    renderFbCta(dayKey, done, total);
  }

  function renderFbCta(dayKey, done, total) {
    const ctaEl = document.getElementById('fbCta');
    if (!ctaEl || total === 0) { if (ctaEl) ctaEl.innerHTML = ''; return; }
    // Botão usa data-action="open-feedback" data-day="..." em vez de onclick inline
    ctaEl.innerHTML = `
      <div style="background:#fff;border:1px solid #EBEBEB;border-radius:16px;padding:20px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
        <div>
          <p style="font-size:0.95rem;font-weight:700;color:#0A0A0A;margin:0 0 3px;">${done === total ? '🎉 Treino concluído!' : `${esc(String(done))} de ${esc(String(total))} exercícios feitos`}</p>
          <p style="font-size:0.82rem;color:#6B7280;margin:0;">Envie seu feedback para o personal</p>
        </div>
        <button data-action="open-feedback" data-day="${dayKey}"
          style="padding:12px 22px;background:#00E676;color:#0A0A0A;border:none;border-radius:12px;font-size:0.875rem;font-weight:800;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;white-space:nowrap;">
          💬 Enviar Feedback
        </button>
      </div>`;
  }

  function switchDay(dayKey) {
    currentDay = dayKey;
    renderTabs(DAYS_ORDER.filter(d => workout.days[d]?.length > 0), workout.days);
    renderDay(dayKey, workout.days);
  }

  function toggleCheck(dayKey, idx) {
    if (!checkedExercises[dayKey]) checkedExercises[dayKey] = new Set();
    const set = checkedExercises[dayKey];
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    renderDay(dayKey, workout.days);
  }

  function openFeedback(dayKey) {
    currentFbDay = dayKey;
    const slider = document.getElementById('effortRange');
    if (slider) { slider.value = 5; updateSliderGradient(slider); }
    document.getElementById('effortVal').textContent = '5';
    document.querySelectorAll('.fb-sensation-label').forEach(l => l.classList.remove('selected'));
    document.getElementById('sIdeal')?.classList.add('selected');
    document.querySelectorAll('.fb-pain-label').forEach(l => l.classList.remove('selected'));
    document.getElementById('hasPainNao')?.classList.add('selected');
    const painLocGroup = document.getElementById('painLocGroup');
    if (painLocGroup) painLocGroup.style.display = 'none';
    const loc     = document.getElementById('painLoc');
    const comment = document.getElementById('fbComment');
    const errDiv  = document.getElementById('fbError');
    if (loc)     loc.value            = '';
    if (comment) comment.value        = '';
    if (errDiv)  errDiv.style.display = 'none';
    document.getElementById('fbOverlay')?.classList.add('open');
  }

  function closeFeedback() { document.getElementById('fbOverlay')?.classList.remove('open'); }

  document.getElementById('fbClose')?.addEventListener('click',  closeFeedback);
  document.getElementById('fbCancel')?.addEventListener('click', closeFeedback);
  document.getElementById('fbOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('fbOverlay')) closeFeedback();
  });

  // effortRange: addEventListener em vez de oninput inline no HTML
  const effortRangeEl = document.getElementById('effortRange');
  effortRangeEl?.addEventListener('input', e => {
    document.getElementById('effortVal').textContent = e.target.value;
    updateSliderGradient(e.target);
  });

  document.querySelectorAll('.fb-sensation-label').forEach(label => {
    label.addEventListener('click', () => {
      document.querySelectorAll('.fb-sensation-label').forEach(l => l.classList.remove('selected'));
      label.classList.add('selected');
    });
  });

  document.querySelectorAll('.fb-pain-label').forEach(label => {
    label.addEventListener('click', () => {
      document.querySelectorAll('.fb-pain-label').forEach(l => l.classList.remove('selected'));
      label.classList.add('selected');
      const painLocGroup = document.getElementById('painLocGroup');
      if (painLocGroup) painLocGroup.style.display = label.querySelector('input').value === 'true' ? 'block' : 'none';
    });
  });

  document.getElementById('fbSubmit')?.addEventListener('click', async () => {
    const errDiv = document.getElementById('fbError');
    if (errDiv) errDiv.style.display = 'none';
    const hasPainInput = document.querySelector('input[name="fbHasPain"]:checked');
    if (!hasPainInput) { if (errDiv) { errDiv.textContent = 'Informe se sentiu dor.'; errDiv.style.display = 'block'; } return; }
    const btn = document.getElementById('fbSubmit');
    btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:3px solid rgba(0,0,0,0.15);border-top-color:#0A0A0A;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;"></span>';
    btn.disabled  = true;
    try {
      const hasPainVal = hasPainInput.value === 'true';
      const sensation  = document.querySelector('input[name="fbSensation"]:checked')?.value || 'ideal';
      const result     = await dbManager.createFeedback({
        workoutId:   workout.id, dayOfWeek: currentFbDay,
        effortLevel: parseInt(document.getElementById('effortRange').value),
        sensation, hasPain: hasPainVal,
        painLocation: hasPainVal ? document.getElementById('painLoc').value.trim() : '',
        comment:      document.getElementById('fbComment').value.trim(),
        weekIdentifier: window.feedbackModel?.getCurrentWeekIdentifier?.() || null,
      });
      if (result.success !== false) {
        closeFeedback();
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0A0A0A;color:#fff;padding:12px 22px;border-radius:12px;font-size:0.875rem;font-weight:600;z-index:9999;';
        t.innerHTML = '✓ Feedback enviado!';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
      } else {
        if (errDiv) { errDiv.textContent = result.error || 'Erro ao enviar.'; errDiv.style.display = 'block'; }
      }
    } catch (e) {
      if (errDiv) { errDiv.textContent = 'Erro inesperado: ' + e.message; errDiv.style.display = 'block'; }
    }
    btn.innerHTML = 'Enviar Feedback'; btn.disabled = false;
  });

  // Init
  const workoutId = getWorkoutId();
  if (!workoutId) {
    document.getElementById('mainContent').innerHTML = '<p style="text-align:center;color:#BE123C;padding:80px;">Treino não encontrado.</p>';
    return;
  }
  try {
    workout = await dbManager.getWorkout(workoutId);
    if (!workout) { document.getElementById('mainContent').innerHTML = '<p style="text-align:center;color:#BE123C;padding:80px;">Treino não encontrado.</p>'; return; }
    sessionStorage.removeItem('viewWorkoutId');
    sessionStorage.removeItem('viewWorkoutDay');
    currentDay = getInitialDay(workout.days || {});
    renderPage();
    if (effortRangeEl) updateSliderGradient(effortRangeEl);
  } catch (e) {
    document.getElementById('mainContent').innerHTML = `<p style="text-align:center;color:#BE123C;padding:80px;">Erro: ${esc(e.message)}</p>`;
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFeedback(); });
};

window.__pageCleanup = function() {
  // globals expostos globalmente para compatibilidade
  // (não há mais, tudo via delegation)
};