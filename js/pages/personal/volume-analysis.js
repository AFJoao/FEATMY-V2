/**
 * js/pages/personal/volume-analysis.js
 * Migrado de script inline em pages/personal/volume-analysis.html
 */
window.__pageInit = async function(params) {
  const MUSCLES = ['Peito','Costas','Ombros','Bíceps','Tríceps','Quadríceps','Posterior','Glúteos','Panturrilhas','Abdômen','Lombar'];
  const MUSCLE_ALIAS = { 'Peito':'Peito','Costas':'Costas','Ombros':'Ombros','Bíceps':'Bíceps','Tríceps':'Tríceps','Pernas':'Quadríceps','Quadríceps':'Quadríceps','Posterior de coxa':'Posterior','Posterior':'Posterior','Glúteos':'Glúteos','Panturrilhas':'Panturrilhas','Panturrilha':'Panturrilhas','Abdômen':'Abdômen','Lombar':'Lombar','Funcional':'Costas','Cardio':'Abdômen','Full Body':'Costas' };
  const MUSCLE_COLOR = { 'Peito':'#3B82F6','Costas':'#10B981','Ombros':'#8B5CF6','Bíceps':'#F59E0B','Tríceps':'#EF4444','Quadríceps':'#06B6D4','Posterior':'#EC4899','Glúteos':'#84CC16','Panturrilhas':'#F97316','Abdômen':'#6366F1','Lombar':'#14B8A6' };
  const VOLUME_REF   = { 'Peito':10,'Costas':12,'Ombros':10,'Bíceps':8,'Tríceps':8,'Quadríceps':12,'Posterior':10,'Glúteos':10,'Panturrilhas':8,'Abdômen':8,'Lombar':8 };

  let studentId   = params?.id || window.routeParams?.id || (() => {
    const hash  = window.location.hash || '';
    const parts = hash.replace('#','').split('/').filter(Boolean);
    const idx   = parts.indexOf('volume');
    return (idx !== -1 && parts[idx+1]) ? parts[idx+1] : '';
  })();

  window._vpStudentId = studentId;

  let studentName        = '';
  let workouts           = [];
  let allExercises       = {};
  let manualPercentages  = {};
  let mode               = 'auto';
  let volumeData         = {};

  document.getElementById('vpLogout').onclick = async () => { await authManager.logout(); router.goToLogin(); };

  function showEmpty(msg) {
    const root = document.getElementById('vpRoot');
    if (root) root.innerHTML = `<div style="min-height:calc(100vh - 64px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#9CA3AF;text-align:center;padding:40px;"><p style="font-size:1rem;font-weight:600;color:rgba(0,0,0,0.55);">${msg}</p><button onclick="router.goToStudentDetails(window._vpStudentId)" style="background:transparent;border:none;color:#9CA3AF;cursor:pointer;padding:8px;font-family:inherit;">Voltar</button></div>`;
  }
  function toast(msg) {
    const el = document.getElementById('vpToast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  function normalizeExName(ex) { return (ex.exerciseName || ex.name || '—').toLowerCase().trim(); }

  function getDefaultPercentages(ex) {
    if (ex.muscles?.length > 0) {
      const obj = {};
      ex.muscles.forEach(m => { const mapped = MUSCLE_ALIAS[m.group]||m.group; if (mapped) obj[mapped] = m.percentage||0; });
      return obj;
    }
    const name   = (ex.exerciseName||ex.name||'').toLowerCase().trim();
    const dbEx   = allExercises[name];
    const mg     = dbEx?.muscleGroup || ex.muscleGroup || ex.muscle || '';
    const mapped = MUSCLE_ALIAS[mg] || null;
    return mapped ? { [mapped]: 100 } : {};
  }

  function initManualPercentages() {
    workouts.forEach(w => {
      Object.values(w.days||{}).forEach(exs => {
        (exs||[]).forEach(ex => {
          const key = normalizeExName(ex);
          if (!manualPercentages[key]) manualPercentages[key] = getDefaultPercentages(ex);
        });
      });
    });
  }

  function calculate() {
    volumeData = {};
    MUSCLES.forEach(m => volumeData[m] = 0);
    workouts.forEach(w => {
      Object.values(w.days||{}).forEach(exs => {
        (exs||[]).forEach(ex => {
          const sets = parseFloat(ex.sets) || 0;
          if (sets === 0) return;
          const pcts = mode === 'manual' ? (manualPercentages[normalizeExName(ex)] || getDefaultPercentages(ex)) : getDefaultPercentages(ex);
          Object.entries(pcts).forEach(([muscle, pct]) => {
            if (MUSCLES.includes(muscle) && pct > 0) volumeData[muscle] += sets * (pct/100);
          });
        });
      });
    });
  }

  function drawRadar() {
    const svg = document.getElementById('radarSvg');
    if (!svg) return;
    const cx = 200, cy = 195, R = 150, n = MUSCLES.length;
    const maxV = Math.max(...MUSCLES.map(m => volumeData[m]||0), 1);
    function getGridPoint(i, r) { const angle = (Math.PI*2*i/n)-Math.PI/2; return [cx+r*Math.cos(angle), cy+r*Math.sin(angle)]; }
    let svgContent = '';
    [0.25,0.5,0.75,1].forEach(ratio => { const pts=MUSCLES.map((_,i)=>getGridPoint(i,R*ratio).join(',')); svgContent+=`<polygon points="${pts.join(' ')}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="1"/>`; });
    MUSCLES.forEach((_,i) => { const [x,y]=getGridPoint(i,R); svgContent+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(0,0,0,0.05)" stroke-width="1"/>`; });
    const volPts = MUSCLES.map((m,i) => { const val=volumeData[m]||0; return getGridPoint(i, R*Math.min(val/maxV, 1)).join(','); });
    svgContent += `<polygon points="${volPts.join(' ')}" fill="rgba(0,230,118,0.12)" stroke="#00C853" stroke-width="2"/>`;
    MUSCLES.forEach((m,i) => { const val=volumeData[m]||0; const [x,y]=getGridPoint(i,R*Math.min(val/maxV,1)); svgContent+=`<circle cx="${x}" cy="${y}" r="5" fill="${MUSCLE_COLOR[m]||'#00C853'}" stroke="#FFFFFF" stroke-width="2"/>`; });
    MUSCLES.forEach((m,i) => { const [lx,ly]=getGridPoint(i,R+22); const val=volumeData[m]||0; svgContent+=`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" font-family="DM Sans,sans-serif" font-weight="700" fill="${val>0?MUSCLE_COLOR[m]||'#888':'rgba(0,0,0,0.2)'}">${m.toUpperCase()}</text>`; });
    svg.innerHTML = svgContent;
  }

  function render() {
    const totalSets    = Object.values(volumeData).reduce((a,b)=>a+b,0);
    const totalEx      = workouts.reduce((s,w)=>s+Object.values(w.days||{}).reduce((ss,exs)=>ss+(exs?.length||0),0),0);
    const activeDays   = new Set();
    workouts.forEach(w => Object.keys(w.days||{}).forEach(d => { if (w.days[d]?.length>0) activeDays.add(d); }));
    const activeMuscles = MUSCLES.filter(m => volumeData[m]>0).length;
    const maxVol        = Math.max(...Object.values(volumeData), 1);

    const root = document.getElementById('vpRoot');
    if (!root) return;

    root.innerHTML = `
      <div class="vp-hero"><div class="vp-hero-label">Análise Semanal</div><h1 class="vp-hero-title">${studentName}</h1><p class="vp-hero-sub">Volume calculado com base nos treinos atribuídos</p></div>
      <div class="vp-stats-row">
        <div class="vp-stat"><div class="vp-stat-label">Séries Totais</div><div class="vp-stat-value" style="color:var(--green);">${Math.round(totalSets)}</div><div class="vp-stat-sub">ponderadas por músculo</div></div>
        <div class="vp-stat"><div class="vp-stat-label">Exercícios</div><div class="vp-stat-value">${totalEx}</div><div class="vp-stat-sub">na semana</div></div>
        <div class="vp-stat"><div class="vp-stat-label">Dias Ativos</div><div class="vp-stat-value">${activeDays.size}</div><div class="vp-stat-sub">de 7 dias</div></div>
        <div class="vp-stat"><div class="vp-stat-label">Músculos</div><div class="vp-stat-value">${activeMuscles}</div><div class="vp-stat-sub">estimulados</div></div>
      </div>
      <div class="vp-mode-row">
        <div><div class="vp-mode-label">Modo de cálculo</div><div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${mode==='auto'?'Usando percentuais padrão':'Percentuais configurados manualmente'}</div></div>
        <div class="vp-toggle">
          <button class="vp-toggle-btn${mode==='auto'?' active':''}" onclick="switchMode('auto')">⚡ Automático</button>
          <button class="vp-toggle-btn${mode==='manual'?' active':''}" onclick="switchMode('manual')">✏️ Manual</button>
        </div>
      </div>
      <div class="vp-main">
        <div>
          <div class="vp-bars-card">
            <div class="vp-bars-title">Estímulo por Grupo Muscular</div>
            ${MUSCLES.map(m => {
              const val   = volumeData[m]||0;
              const pct   = Math.min((val/maxVol)*100, 100);
              const ref   = VOLUME_REF[m]||10;
              const ratio = val/ref;
              let status, statusColor;
              if (val===0)       { status='ZERO'; statusColor='rgba(0,0,0,0.25)'; }
              else if(ratio<0.5) { status='BAIXO'; statusColor='#EF4444'; }
              else if(ratio<0.85){ status='OK';   statusColor='#F59E0B'; }
              else if(ratio<=1.3){ status='IDEAL'; statusColor='#00E676'; }
              else               { status='ALTO'; statusColor='#EF4444'; }
              return `<div class="vp-bar-row">
                <div class="vp-bar-muscle">${m}</div>
                <div class="vp-bar-track"><div class="vp-bar-fill" style="width:0%;background:${MUSCLE_COLOR[m]||'#888'};" data-target="${pct}"></div></div>
                <div class="vp-bar-val" style="color:${MUSCLE_COLOR[m]||'#888'};">${val.toFixed(1)}</div>
              </div>`;
            }).join('')}
          </div>
          <div class="vp-visual-card" style="margin-top:20px;">
            <div class="vp-visual-title">Mapa de Equilíbrio Muscular</div>
            <div style="display:flex;align-items:center;justify-content:center;">
              <svg id="radarSvg" viewBox="0 0 400 380" width="100%" style="max-width:420px;"></svg>
            </div>
          </div>
        </div>
        <div id="sidePanel"></div>
      </div>
      <div style="max-width:1100px;margin:0 auto 60px;padding:0 28px;" id="insightsGrid"></div>`;

    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('.vp-bar-fill[data-target]').forEach(el => { el.style.width = el.dataset.target + '%'; });
      }, 80);
    });

    drawRadar();
    renderSidePanel();
    renderInsights();

    window.switchMode = function(m) { mode = m; calculate(); render(); };
    if (mode === 'manual') {
      document.getElementById('vpReset')?.addEventListener('click', () => { manualPercentages={}; initManualPercentages(); calculate(); render(); toast('Percentuais resetados'); });
      document.getElementById('vpRecalc')?.addEventListener('click', () => {
        document.querySelectorAll('.vp-pct-input[data-key]').forEach(input => {
          const key = input.dataset.key; const muscle = input.dataset.muscle;
          if (!key||!muscle) return;
          if (!manualPercentages[key]) manualPercentages[key]={};
          manualPercentages[key][muscle] = parseFloat(input.value)||0;
        });
        calculate(); render(); toast('✓ Recalculado');
      });
    }
  }

  function renderSidePanel() {
    const panel = document.getElementById('sidePanel');
    if (!panel) return;
    if (mode === 'manual') {
      const seen = new Set(); const uniqueEx = [];
      workouts.forEach(w => {
        Object.entries(w.days||{}).forEach(([day, exs]) => {
          (exs||[]).forEach(ex => {
            const key = normalizeExName(ex);
            if (!seen.has(key)) { seen.add(key); uniqueEx.push({ key, ex, days:[] }); }
            const entry = uniqueEx.find(e => e.key === key);
            const dayShort = { monday:'Seg',tuesday:'Ter',wednesday:'Qua',thursday:'Qui',friday:'Sex',saturday:'Sáb',sunday:'Dom' }[day];
            if (entry && dayShort && !entry.days.includes(dayShort)) entry.days.push(dayShort);
          });
        });
      });

      let html = `<div class="vp-manual-card"><div class="vp-manual-header"><div class="vp-manual-title">Ajustar Percentuais</div><button class="vp-manual-reset" id="vpReset">Resetar</button></div><div class="vp-manual-body">`;
      uniqueEx.forEach(({ key, ex, days: exDays }) => {
        const pcts = manualPercentages[key] || getDefaultPercentages(ex);
        const name = ex.exerciseName || ex.name || '—';
        const sets = ex.sets || '?';
        html += `<div class="vp-ex-item"><div class="vp-ex-name">${name} <span style="font-size:0.6rem;color:var(--text-muted);">${sets} séries · ${exDays.join(' ')}</span></div><div class="vp-ex-muscles">`;
        Object.keys(pcts).forEach(m => {
          html += `<div class="vp-muscle-row"><div class="vp-muscle-name" style="color:${MUSCLE_COLOR[m]||'rgba(0,0,0,0.4)'};">${m}</div><input type="number" class="vp-pct-input" min="0" max="100" value="${pcts[m]||0}" data-key="${key}" data-muscle="${m}"><span class="vp-pct-label">%</span></div>`;
        });
        html += `</div></div>`;
      });
      html += `</div><button class="vp-recalc" id="vpRecalc">↻ Recalcular Volume</button></div>`;
      panel.innerHTML = html;
    } else {
      panel.innerHTML = `<div class="vp-manual-card" style="border-radius:18px;"><div class="vp-manual-header"><div class="vp-manual-title">Exercícios da Semana</div></div><div class="vp-manual-body" style="max-height:620px;">${workouts.map(w => {
        const days = w.days||{};
        const dayOrder = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        const dPt      = { monday:'Seg',tuesday:'Ter',wednesday:'Qua',thursday:'Qui',friday:'Sex',saturday:'Sáb',sunday:'Dom' };
        return `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);"><div style="font-size:0.78rem;font-weight:700;margin-bottom:10px;">${w.name}</div>${dayOrder.map(d => { const exs=days[d]; if(!exs?.length) return ''; return `<div style="margin-bottom:8px;"><div style="font-size:0.65rem;font-weight:700;color:var(--green);text-transform:uppercase;margin-bottom:5px;">${dPt[d]}</div>${exs.map(ex=>`<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;"><span style="font-size:0.62rem;color:var(--text-muted);min-width:28px;">${ex.sets||'?'}s</span><div><div style="font-size:0.75rem;font-weight:600;">${ex.exerciseName||ex.name||'—'}</div></div></div>`).join('')}</div>`; }).join('')}</div>`;
      }).join('')}</div></div>`;
    }
  }

  function renderInsights() {
    const el = document.getElementById('insightsGrid');
    if (!el) return;
    let topMuscle='Nenhum', topVal=0;
    MUSCLES.forEach(m => { if(volumeData[m]>topVal){topVal=volumeData[m];topMuscle=m;} });
    const neglected = MUSCLES.filter(m => volumeData[m]>0 && volumeData[m]<(VOLUME_REF[m]||10)*0.5);
    const push = (volumeData['Peito']||0)+(volumeData['Ombros']||0)+(volumeData['Tríceps']||0);
    const pull = (volumeData['Costas']||0)+(volumeData['Bíceps']||0);
    const ppRatio = pull>0 ? push/pull : 999;
    let ppInsight, ppColor;
    if (pull===0&&push===0) { ppInsight='Sem dados de push/pull'; ppColor='rgba(0,0,0,0.04)'; }
    else if(ppRatio<0.7)   { ppInsight=`Pull dominante (${pull.toFixed(1)} vs ${push.toFixed(1)})`; ppColor='rgba(245,158,11,0.08)'; }
    else if(ppRatio>1.5)   { ppInsight=`Push dominante (${push.toFixed(1)} vs ${pull.toFixed(1)})`; ppColor='rgba(239,68,68,0.08)'; }
    else                   { ppInsight=`Equilibrado (${push.toFixed(1)} push / ${pull.toFixed(1)} pull)`; ppColor='rgba(0,230,118,0.08)'; }
    el.style.cssText='max-width:1100px;margin:0 auto 60px;padding:0 28px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;';
    el.innerHTML = `
      <div style="background:rgba(0,230,118,0.06);border:1px solid rgba(0,230,118,0.2);border-radius:14px;padding:16px;"><div style="font-size:1.3rem;margin-bottom:6px;">🏆</div><div style="font-size:0.72rem;font-weight:700;color:var(--green);margin-bottom:3px;">Mais estimulado</div><div style="font-size:0.7rem;color:var(--text-muted);line-height:1.5;">${topMuscle} com <strong style="color:#111;">${topVal.toFixed(1)} séries</strong>.</div></div>
      <div style="background:${ppColor};border:1px solid rgba(0,0,0,0.1);border-radius:14px;padding:16px;"><div style="font-size:1.3rem;margin-bottom:6px;">⚖️</div><div style="font-size:0.72rem;font-weight:700;color:#F59E0B;margin-bottom:3px;">Balanço Push/Pull</div><div style="font-size:0.7rem;color:var(--text-muted);line-height:1.5;">${ppInsight}</div></div>
      <div style="background:${neglected.length>0?'rgba(239,68,68,0.06)':'rgba(0,230,118,0.06)'};border:1px solid rgba(0,0,0,0.1);border-radius:14px;padding:16px;"><div style="font-size:1.3rem;margin-bottom:6px;">${neglected.length>0?'⚠️':'✅'}</div><div style="font-size:0.72rem;font-weight:700;color:${neglected.length>0?'#EF4444':'var(--green)'};margin-bottom:3px;">${neglected.length>0?'Atenção necessária':'Volume equilibrado'}</div><div style="font-size:0.7rem;color:var(--text-muted);line-height:1.5;">${neglected.length>0?`${neglected.join(', ')} abaixo do ideal.`:'Todos os grupos dentro da faixa.'}</div></div>`;
  }

  if (!studentId) { showEmpty('ID do aluno não encontrado.'); return; }
  try {
    const [student, wks, exList] = await Promise.all([
      dbManager.getUserData(studentId),
      dbManager.getStudentWorkouts(studentId),
      dbManager.getPersonalExercises(),
    ]);
    studentName = student?.name || 'Aluno';
    workouts    = wks || [];
    (exList||[]).forEach(ex => { const key=(ex.name||'').toLowerCase().trim(); allExercises[key]=ex; });
    if (workouts.length === 0) { showEmpty('Este aluno não possui treinos cadastrados.'); return; }
    initManualPercentages(); calculate(); render();
  } catch (e) { showEmpty('Erro ao carregar dados: ' + e.message); }
};

window.__pageCleanup = function() {
  delete window.switchMode;
  delete window._vpStudentId;
};
