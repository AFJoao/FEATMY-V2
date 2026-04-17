/**
 * js/pages/personal/create-workout.js
 * Migrado de script inline em pages/personal/create-workout.html
 *
 * CORREÇÃO CSP v2:
 * - cardHtml(): removidos onclick="removeCard(...)" e oncontextmenu="ctxShow(...)" inline.
 *   Substituídos por data-action, data-day e data-idx nos elementos.
 *   Event delegation via bindCardEvents() lida com todos os cards do board.
 *
 * - renderBoard(): removidos onclick="copyDayHandler(...)", onclick="openModal(...)"
 *   Substituídos por data-action + data-day nos botões.
 *   Event delegation via bindBoardEvents() no kanbanBoard.
 *
 * - window.removeCard, window.openModal, window.ctxShow, window.copyDayHandler
 *   Mantidos como window.* para retrocompatibilidade com código legado, mas
 *   não são mais chamados via atributos inline.
 */
window.__pageInit = async function() {
  await new Promise(r => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', r) : r());
  await new Promise(r => setTimeout(r, 120));

  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\//g,'&#x2F;');
  };

  const DAYS = [
    { key:'monday',    short:'SEG', full:'Segunda' },
    { key:'tuesday',   short:'TER', full:'Terça'   },
    { key:'wednesday', short:'QUA', full:'Quarta'  },
    { key:'thursday',  short:'QUI', full:'Quinta'  },
    { key:'friday',    short:'SEX', full:'Sexta'   },
    { key:'saturday',  short:'SÁB', full:'Sábado'  },
    { key:'sunday',    short:'DOM', full:'Domingo' },
  ];

  const MC = {
    Peito:'#2563EB|#EFF6FF', Costas:'#059669|#ECFDF5', Pernas:'#D97706|#FEF3C7',
    Ombros:'#7C3AED|#F5F3FF', Bíceps:'#EA580C|#FFF7ED', Tríceps:'#BE185D|#FDF2F8',
    Abdômen:'#0891B2|#ECFEFF', Glúteos:'#16A34A|#F0FDF4', Cardio:'#DC2626|#FEF2F2',
    'Full Body':'#6B7280|#F3F4F6',
  };
  function mStyle(m) { const p=(MC[m]||'#6B7280|#F3F4F6').split('|'); return `color:${p[0]};background:${p[1]};`; }

  function E(name,muscle,sets,reps,rest,obs='') { return { id:uid(), name, muscle, sets:String(sets), reps:String(reps), rest:String(rest), obs }; }
  function uid() { return Math.random().toString(36).slice(2,9); }

  const PRESETS = {
    abc:{ monday:[E('Supino Reto','Peito',4,'10','90s'),E('Crucifixo','Peito',3,'12','60s'),E('Tríceps Pulley','Tríceps',3,'15','60s')], wednesday:[E('Puxada Frontal','Costas',4,'10','90s'),E('Remada Curvada','Costas',3,'12','90s'),E('Rosca Direta','Bíceps',3,'12','60s')], friday:[E('Agachamento','Pernas',4,'10','120s'),E('Leg Press','Pernas',3,'12','90s'),E('Panturrilha','Pernas',4,'20','45s')] },
    abcd:{ monday:[E('Supino Reto','Peito',4,'10','90s'),E('Supino Inclinado','Peito',3,'12','90s'),E('Tríceps Pulley','Tríceps',3,'15','60s')], tuesday:[E('Puxada Frontal','Costas',4,'10','90s'),E('Remada Curvada','Costas',4,'10','90s'),E('Rosca Direta','Bíceps',3,'12','60s')], thursday:[E('Agachamento','Pernas',4,'10','120s'),E('Leg Press','Pernas',3,'12','90s'),E('Mesa Flexora','Pernas',3,'12','60s')], friday:[E('Desenvolvimento','Ombros',4,'10','90s'),E('Elevação Lateral','Ombros',3,'15','60s'),E('Panturrilha','Pernas',4,'20','45s')] },
    upper_lower:{ monday:[E('Supino Reto','Peito',4,'8','120s'),E('Remada Curvada','Costas',4,'8','120s'),E('Desenvolvimento','Ombros',3,'10','90s'),E('Rosca Direta','Bíceps',3,'12','60s'),E('Tríceps Pulley','Tríceps',3,'12','60s')], tuesday:[E('Agachamento','Pernas',4,'8','120s'),E('Leg Press','Pernas',3,'12','90s'),E('Mesa Flexora','Pernas',3,'12','60s'),E('Panturrilha','Pernas',4,'20','45s')], thursday:[E('Supino Inclinado','Peito',4,'10','90s'),E('Puxada Frontal','Costas',4,'10','90s'),E('Elevação Lateral','Ombros',3,'15','60s'),E('Rosca Martelo','Bíceps',3,'12','60s')], friday:[E('Levantamento Terra','Costas',4,'6','180s'),E('Cadeira Extensora','Pernas',3,'15','60s'),E('Afundo','Pernas',3,'12','60s')] },
    fullbody:{ monday:[E('Agachamento','Pernas',3,'10','120s'),E('Supino Reto','Peito',3,'10','90s'),E('Remada Curvada','Costas',3,'10','90s'),E('Desenvolvimento','Ombros',3,'10','90s')], wednesday:[E('Levantamento Terra','Costas',3,'8','180s'),E('Supino Inclinado','Peito',3,'10','90s'),E('Puxada Frontal','Costas',3,'10','90s'),E('Elevação Lateral','Ombros',3,'15','60s')], friday:[E('Afundo','Pernas',3,'10','90s'),E('Crucifixo','Peito',3,'12','60s'),E('Remada Unilateral','Costas',3,'10','90s'),E('Prancha','Abdômen',3,'45s','30s')] },
    ppl:{ monday:[E('Supino Reto','Peito',4,'8','120s'),E('Supino Inclinado','Peito',3,'10','90s'),E('Desenvolvimento','Ombros',3,'10','90s'),E('Elevação Lateral','Ombros',3,'15','60s'),E('Tríceps Pulley','Tríceps',3,'15','60s')], tuesday:[E('Puxada Frontal','Costas',4,'10','90s'),E('Remada Curvada','Costas',4,'10','90s'),E('Rosca Direta','Bíceps',3,'12','60s'),E('Rosca Martelo','Bíceps',3,'12','60s')], wednesday:[E('Agachamento','Pernas',4,'10','120s'),E('Leg Press','Pernas',3,'12','90s'),E('Cadeira Extensora','Pernas',3,'15','60s'),E('Panturrilha','Pernas',4,'20','45s')], thursday:[E('Supino Inclinado','Peito',4,'10','90s'),E('Crucifixo','Peito',3,'12','60s'),E('Elevação Frontal','Ombros',3,'15','60s'),E('Tríceps Testa','Tríceps',3,'12','60s')], friday:[E('Levantamento Terra','Costas',4,'6','180s'),E('Puxada Neutra','Costas',3,'12','90s'),E('Rosca Concentrada','Bíceps',3,'12','60s')], saturday:[E('Agachamento Búlgaro','Pernas',3,'10','90s'),E('Afundo','Pernas',3,'12','90s'),E('Prancha','Abdômen',3,'45s','30s')] },
  };

  let board        = {};
  let allExercises = [];
  let targetDay    = null;
  let selectedEx   = null;
  let clipboard    = null;
  let dragSrc      = null;
  let ctxTarget    = null;
  let currentTab   = 'search';
  let editingId    = null;

  DAYS.forEach(d => board[d.key] = []);

  document.getElementById('logoutBtn').onclick = async () => { await authManager.logout(); router.goToLogin(); };

  // Lógica do botão sair em mobile
  const logoutSvg = document.querySelector('#logoutBtn svg');
  if (logoutSvg) {
    const updateLogout = () => {
      const isMobile = window.innerWidth <= 768;
      logoutSvg.style.display = isMobile ? 'block' : 'none';
      const label = document.querySelector('#logoutBtn .cw-nav-label');
      if (label) label.style.display = isMobile ? 'none' : 'block';
    };
    window.addEventListener('resize', updateLogout);
    updateLogout();
  }

  try {
    const students = await dbManager.getMyStudents();
    const sel      = document.getElementById('studentSelect');
    if (sel) {
      students.forEach(s => {
        const o = document.createElement('option');
        o.value = s.uid; o.textContent = s.name;
        sel.appendChild(o);
      });
      const preSelected = sessionStorage.getItem('preSelectedStudent');
      if (preSelected) { sel.value = preSelected; sessionStorage.removeItem('preSelectedStudent'); }
    }
    const editId = sessionStorage.getItem('editWorkoutId');
    if (editId) { sessionStorage.removeItem('editWorkoutId'); await loadWorkout(editId); }
  } catch (e) { console.warn('Alunos:', e); }

  try { allExercises = await dbManager.getPersonalExercises() || []; }
  catch { allExercises = []; }

  async function loadWorkout(id) {
    try {
      const w = await dbManager.getWorkout(id);
      if (!w) return;
      editingId = id;
      const nameEl = document.getElementById('workoutName');
      const selEl  = document.getElementById('studentSelect');
      if (nameEl) nameEl.value = w.name || '';
      if (selEl)  selEl.value  = w.studentId || '';
      DAYS.forEach(d => {
        board[d.key] = (w.days?.[d.key] || []).map(e => ({
          id: uid(), name: e.exerciseName || e.name || '', muscle: e.muscleGroup || e.muscle || '',
          sets: String(e.sets||3), reps: String(e.reps||12), rest: String(e.rest||'60s'), obs: e.obs || '',
        }));
      });
      renderBoard(); toast('Rotina carregada ✓');
    } catch (e) { console.warn(e); }
  }

  function toast(msg, ms = 2200) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  }

  /**
   * cardHtml — CORRIGIDO CSP:
   * Removidos onclick="removeCard(...)" e oncontextmenu="ctxShow(...)" inline.
   * Substituídos por data-action + data-day + data-idx para event delegation.
   */
  function cardHtml(e, day, idx) {
    return `<div class="ex-card" draggable="true" data-day="${day}" data-idx="${idx}" data-action="ctx-show">
      <div class="ex-card-name">${esc(e.name)}</div>
      <div class="ex-card-meta">
        <span class="ex-badge" style="background:#111827;color:#fff;">${esc(e.sets)}×${esc(e.reps)}</span>
        ${e.muscle ? `<span class="ex-badge" style="${mStyle(e.muscle)}">${esc(e.muscle)}</span>` : ''}
        ${e.rest ? `<span class="ex-badge" style="background:#F3F4F6;color:#6B7280;">⏱${esc(e.rest)}</span>` : ''}
      </div>
      ${e.obs ? `<div style="font-size:0.62rem;color:#9CA3AF;margin-top:3px;font-style:italic;">${esc(e.obs)}</div>` : ''}
      <button class="ex-delete-btn" data-action="remove-card" data-day="${day}" data-idx="${idx}">
        🗑 Remover
      </button>
    </div>`;
  }

  /**
   * renderBoard — CORRIGIDO CSP:
   * Removidos onclick="copyDayHandler(...)", onclick="openModal(...)" inline.
   * Substituídos por data-action + data-day nos botões.
   */
  function renderBoard() {
    const b = document.getElementById('kanbanBoard');
    if (!b) return;
    b.innerHTML = '';
    DAYS.forEach(d => {
      const col = document.createElement('div');
      col.className = 'day-column';
      col.dataset.day = d.key;
      const hasClip   = !!(clipboard?.data?.length > 0);
      const exHtml    = board[d.key].map((e, i) => cardHtml(e, d.key, i)).join('');
      col.innerHTML = `
        <div class="day-header">
          <div class="day-label-short">${d.short}</div>
          <div class="day-label-full">${d.full}</div>
          <div class="day-ex-count">${board[d.key].length} exerc.</div>
          <button class="copy-day-btn${hasClip?' has-clipboard':''}" data-action="copy-day" data-day="${d.key}" title="${hasClip?'Colar dia copiado':'Copiar este dia'}">
            ${hasClip ? '📋 Colar' : '📄 Copiar'}
          </button>
        </div>
        <div class="drop-zone" id="zone-${d.key}" data-day="${d.key}">
          ${board[d.key].length === 0 ? `<div class="drop-placeholder" data-action="open-modal" data-day="${d.key}"><span>+ Adicionar</span></div>` : ''}
          ${exHtml}
          <button class="add-ex-btn" data-action="open-modal" data-day="${d.key}">+ Adicionar</button>
        </div>`;
      b.appendChild(col);
    });
    bindDrag();
    bindDrop();
    // Event delegation para todos os botões do board (substitui onclick inline)
    bindBoardEvents(b);
  }

  /**
   * bindBoardEvents — NOVO: event delegation para o kanbanBoard inteiro.
   * Elimina a necessidade de onclick inline em cardHtml e renderBoard.
   */
  function bindBoardEvents(boardEl) {
    boardEl.addEventListener('click', (e) => {
      // Remover card
      const removeBtn = e.target.closest('[data-action="remove-card"]');
      if (removeBtn) {
        e.stopPropagation();
        removeCard(removeBtn.dataset.day, parseInt(removeBtn.dataset.idx, 10));
        return;
      }
      // Abrir modal de exercício (drop-placeholder ou add-ex-btn)
      const openModalEl = e.target.closest('[data-action="open-modal"]');
      if (openModalEl) {
        openModal(openModalEl.dataset.day);
        return;
      }
      // Copiar/colar dia
      const copyDayBtn = e.target.closest('[data-action="copy-day"]');
      if (copyDayBtn) {
        e.stopPropagation();
        copyDayHandler(e, copyDayBtn.dataset.day);
        return;
      }
    });

    boardEl.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('[data-action="ctx-show"]');
      if (card) {
        ctxShow(e, card.dataset.day, parseInt(card.dataset.idx, 10));
      }
    });
  }

  window.copyDayHandler = function(e, day) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (clipboard?.data?.length > 0) {
      const count = clipboard.data.length;
      clipboard.data.forEach(ex => board[day].push({ ...ex, id: uid() }));
      clipboard = null;
      renderBoard(); toast(`✓ ${count} exerc. colados`);
    } else {
      if (board[day].length === 0) return toast('⚠ Dia vazio, nada para copiar');
      clipboard = { type:'day', data: board[day].map(ex => ({ ...ex })) };
      renderBoard(); toast(`✓ ${board[day].length} exerc. copiados — clique Colar em outro dia`);
    }
  };

  function bindDrag() {
    document.querySelectorAll('.ex-card').forEach(c => {
      c.addEventListener('dragstart', e => {
        dragSrc = { day: c.dataset.day, idx: parseInt(c.dataset.idx) };
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => c.classList.add('dragging'), 0);
      });
      c.addEventListener('dragend', () => {
        c.classList.remove('dragging');
        document.querySelectorAll('.day-column').forEach(col => col.classList.remove('drag-over'));
        dragSrc = null;
      });
    });
  }

  function bindDrop() {
    document.querySelectorAll('.drop-zone').forEach(zone => {
      const day = zone.dataset.day;
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.closest('.day-column').classList.add('drag-over'); });
      zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.closest('.day-column').classList.remove('drag-over'); });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.closest('.day-column').classList.remove('drag-over');
        if (!dragSrc) return;
        const { day: srcDay, idx: srcIdx } = dragSrc;
        const cards    = [...zone.querySelectorAll('.ex-card')];
        let dropIdx    = board[day].length;
        for (let i = 0; i < cards.length; i++) {
          const r = cards[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
        }
        const moved = board[srcDay].splice(srcIdx, 1)[0];
        if (srcDay === day) board[day].splice(dropIdx > srcIdx ? dropIdx - 1 : dropIdx, 0, moved);
        else board[day].splice(dropIdx, 0, moved);
        renderBoard(); toast('✓ Exercício movido');
      });
    });
  }

  window.removeCard = function(day, idx) { board[day].splice(idx, 1); renderBoard(); };

  window.openModal = function(day) {
    targetDay  = day; selectedEx = null;
    const si   = document.getElementById('exSearchInput');
    const sets = document.getElementById('exSets');
    const reps = document.getElementById('exReps');
    const rest = document.getElementById('exRest');
    const sei  = document.getElementById('selectedExInfo');
    if (si)   si.value   = '';
    if (sets) sets.value = '3';
    if (reps) reps.value = '12';
    if (rest) rest.value = '60s';
    if (sei)  sei.style.display = 'none';
    renderExList(''); switchTab('search');
    document.getElementById('exModal')?.classList.add('open');
    setTimeout(() => document.getElementById('exSearchInput')?.focus(), 80);
  };

  window.switchTab = function(tab) {
    currentTab = tab;
    document.getElementById('contentSearch').style.display = tab === 'search' ? 'block' : 'none';
    document.getElementById('contentManual').style.display = tab === 'manual' ? 'block' : 'none';
    document.getElementById('tabSearch').className = 'tab-btn' + (tab === 'search' ? ' active' : '');
    document.getElementById('tabManual').className = 'tab-btn' + (tab === 'manual' ? ' active' : '');
  };

  // Bind dos botões de tab do modal — data-tab em vez de onclick inline
  document.getElementById('tabSearch')?.addEventListener('click', () => switchTab('search'));
  document.getElementById('tabManual')?.addEventListener('click', () => switchTab('manual'));

  function renderExList(q) {
    const list = document.getElementById('exSearchList');
    if (!list) return;
    let items = allExercises;
    if (q) items = items.filter(e => (e.name||'').toLowerCase().includes(q.toLowerCase()) || (e.muscleGroup||e.muscle||'').toLowerCase().includes(q.toLowerCase()));
    if (items.length === 0) { list.innerHTML = `<div style="padding:14px;text-align:center;color:#9CA3AF;font-size:0.8rem;">Nenhum resultado. Use a aba Manual.</div>`; return; }
    list.innerHTML = items.slice(0,60).map((e,i) => `
      <div class="ex-search-item${selectedEx?.name===e.name?' selected':''}"
           data-action="sel-ex" data-idx="${i}" data-name="${esc((e.name||'').replace(/"/g,'&quot;'))}" data-muscle="${esc(((e.muscleGroup||e.muscle)||'').replace(/"/g,'&quot;'))}">
        <div class="ex-search-name">${esc(e.name||'?')}</div>
        <div class="ex-search-muscle">${esc(e.muscleGroup||e.muscle||'—')}</div>
      </div>`).join('');

    // Event delegation para itens da lista
    list.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action="sel-ex"]');
      if (item) selEx(parseInt(item.dataset.idx,10), item.dataset.name, item.dataset.muscle);
    });
  }

  window.selEx = function(i, name, muscle) {
    selectedEx = { name, muscle };
    const sei = document.getElementById('selectedExInfo');
    if (sei) sei.style.display = 'block';
    renderExList(document.getElementById('exSearchInput')?.value || '');
  };

  document.getElementById('exSearchInput')?.addEventListener('input', e => renderExList(e.target.value));
  document.getElementById('closeExModal')?.addEventListener('click',  () => document.getElementById('exModal')?.classList.remove('open'));
  document.getElementById('cancelExModal')?.addEventListener('click', () => document.getElementById('exModal')?.classList.remove('open'));
  document.getElementById('exModal')?.addEventListener('click', e => { if (e.target === document.getElementById('exModal')) document.getElementById('exModal').classList.remove('open'); });

  document.getElementById('confirmAddEx')?.addEventListener('click', () => {
    if (currentTab === 'search') {
      if (!selectedEx) return toast('⚠ Selecione um exercício');
      board[targetDay].push({ id:uid(), name:selectedEx.name, muscle:selectedEx.muscle, sets:document.getElementById('exSets')?.value||'3', reps:document.getElementById('exReps')?.value||'12', rest:document.getElementById('exRest')?.value||'60s', obs:'' });
    } else {
      const name = document.getElementById('manualName')?.value.trim();
      if (!name) return toast('⚠ Insira o nome');
      board[targetDay].push({ id:uid(), name, muscle:document.getElementById('manualMuscle')?.value||'', sets:document.getElementById('manualSets')?.value||'3', reps:document.getElementById('manualReps')?.value||'12', rest:document.getElementById('manualRest')?.value||'60s', obs:document.getElementById('manualObs')?.value||'' });
      const mn = document.getElementById('manualName'); const mo = document.getElementById('manualObs');
      if (mn) mn.value = ''; if (mo) mo.value = '';
    }
    document.getElementById('exModal')?.classList.remove('open');
    renderBoard();
    toast(`✓ Adicionado em ${DAYS.find(d => d.key === targetDay)?.full}`);
  });

  document.getElementById('loadPresetBtn')?.addEventListener('click', () => {
    const v = document.getElementById('presetSelect')?.value;
    if (!v) return toast('Selecione um preset');
    DAYS.forEach(d => board[d.key] = []);
    Object.entries(PRESETS[v]).forEach(([day, list]) => { board[day] = list.map(e => ({ ...e, id:uid() })); });
    renderBoard(); toast('✓ Preset carregado!');
    const ps = document.getElementById('presetSelect'); if (ps) ps.value = '';
  });

  document.getElementById('clearBoardBtn')?.addEventListener('click', () => document.getElementById('confirmClearModal')?.classList.add('open'));
  document.getElementById('cancelClear')?.addEventListener('click',   () => document.getElementById('confirmClearModal')?.classList.remove('open'));
  document.getElementById('confirmClear')?.addEventListener('click',  () => {
    DAYS.forEach(d => board[d.key] = []); clipboard = null;
    renderBoard(); document.getElementById('confirmClearModal')?.classList.remove('open'); toast('Quadro limpo');
  });

  window.ctxShow = function(e, day, idx) {
    e.preventDefault(); e.stopPropagation();
    ctxTarget = { day, idx };
    const menu     = document.getElementById('ctxMenu');
    const hasCb    = !!(clipboard?.data?.length > 0);
    const ctxPaste = document.getElementById('ctxPaste');
    if (ctxPaste) { ctxPaste.style.opacity = hasCb ? '1' : '0.4'; ctxPaste.style.pointerEvents = hasCb ? 'auto' : 'none'; }
    if (menu) { menu.style.left = Math.min(e.clientX, window.innerWidth-180)+'px'; menu.style.top = Math.min(e.clientY, window.innerHeight-140)+'px'; menu.classList.add('open'); }
  };

  document.addEventListener('click', () => document.getElementById('ctxMenu')?.classList.remove('open'));

  document.getElementById('ctxEdit')?.addEventListener('click', () => {
    if (!ctxTarget) return;
    const ex = board[ctxTarget.day][ctxTarget.idx];
    const s  = prompt('Séries:', ex.sets); if (s === null) return;
    const r  = prompt('Reps/Tempo:', ex.reps); if (r === null) return;
    const rs = prompt('Descanso:', ex.rest); if (rs === null) return;
    const o  = prompt('Observações:', ex.obs);
    board[ctxTarget.day][ctxTarget.idx] = { ...ex, sets:s, reps:r, rest:rs, obs:o||'' };
    renderBoard(); toast('✓ Atualizado');
  });

  document.getElementById('ctxPaste')?.addEventListener('click', () => {
    if (!ctxTarget || !clipboard) return;
    const count    = clipboard.data.length;
    const dayName  = DAYS.find(d => d.key === ctxTarget.day)?.full;
    clipboard.data.forEach(ex => board[ctxTarget.day].push({ ...ex, id:uid() }));
    clipboard = null;
    document.getElementById('pasteBadge')?.classList.remove('visible');
    renderBoard(); toast(`✓ ${count} exerc. colados em ${dayName}`);
  });

  document.getElementById('ctxDelete')?.addEventListener('click', () => {
    if (ctxTarget) { removeCard(ctxTarget.day, ctxTarget.idx); toast('Exercício removido'); }
  });

  document.getElementById('saveWorkoutBtn')?.addEventListener('click', async () => {
    const studentId = document.getElementById('studentSelect')?.value;
    const name      = document.getElementById('workoutName')?.value.trim();
    if (!studentId) return toast('⚠ Selecione um aluno');
    if (!name)      return toast('⚠ Insira o nome da rotina');
    const total = DAYS.reduce((a, d) => a + board[d.key].length, 0);
    if (total === 0) return toast('⚠ Adicione pelo menos um exercício');

    const saveBtn = document.getElementById('saveWorkoutBtn');
    const origHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = '<div class="spinner" style="border-top-color:#0A0A0A;"></div>';
    saveBtn.disabled  = true;

    const daysData = {};
    DAYS.forEach(d => {
      if (board[d.key].length > 0) {
        daysData[d.key] = board[d.key].map(e => ({ exerciseName:e.name||'', muscleGroup:e.muscle||'', sets:parseInt(e.sets)||3, reps:e.reps||'12', rest:e.rest||'60s', obs:e.obs||'' }));
      }
    });

    try {
      let result;
      if (editingId) result = await dbManager.updateWorkout(editingId, { name, studentId, days: daysData });
      else           result = await dbManager.createWorkout({ name, studentId, description:'', days: daysData });
      if (result && result.success !== false) {
        toast(`✓ Rotina "${name}" salva!`, 3000);
        setTimeout(() => router.goToPersonalDashboard(), 1800);
      } else { toast('Erro: ' + (result?.error || 'Tente novamente')); }
    } catch { toast('Erro ao salvar. Veja o console.'); }
    finally {
      saveBtn.innerHTML = origHtml;
      saveBtn.disabled  = false;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('exModal')?.classList.remove('open');
      document.getElementById('confirmClearModal')?.classList.remove('open');
      document.getElementById('ctxMenu')?.classList.remove('open');
    }
  });

  renderBoard(); renderExList('');
};

window.__pageCleanup = function() {
  delete window.copyDayHandler;
  delete window.openModal;
  delete window.switchTab;
  delete window.selEx;
  delete window.ctxShow;
  delete window.removeCard;
};