/**
 * js/pages/personal/volume-analysis.js
 *
 * Análise de volume semanal por grupo muscular.
 * CORREÇÃO: Este arquivo era uma cópia de create-workout.js — completamente reescrito
 * com a lógica correta de análise de volume.
 */
window.__pageInit = async function() {
  await new Promise(r => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', r) : r());
  await new Promise(r => setTimeout(r, 80));

  const esc = window.esc || function(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\//g, '&#x2F;');
  };

  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const MC_COLORS = {
    Peito:    '#2563EB', Costas:   '#059669', Pernas:   '#D97706',
    Ombros:   '#7C3AED', Bíceps:   '#EA580C', Tríceps:  '#BE185D',
    Abdômen:  '#0891B2', Glúteos:  '#16A34A', Cardio:   '#DC2626',
    'Full Body': '#6B7280', Quadríceps: '#0D9488', Posterior: '#9333EA',
    Panturrilhas: '#0369A1', Lombar: '#854D0E', Funcional: '#4F46E5',
  };

  // Estado da análise
  let workout       = null;
  let studentId     = null;
  let volumeMode    = 'sets';   // 'sets' | 'exercises'
  let manualPcts    = {};       // overrides de porcentagem por exercício
  let computed      = {};       // { muscleGroup: { sets, exercises, pct } }

  // ── Resolução do studentId ─────────────────────────────────────
  studentId = window.routeParams?.id || (() => {
    const parts = (window.location.hash || '').replace('#', '').split('/').filter(Boolean);
    const idx   = parts.indexOf('volume');
    return (idx !== -1 && parts[idx + 1]) ? parts[idx + 1] : '';
  })();

  // ── Controles de navegação ──────────────────────────────────────
  document.getElementById('vpBackBtn')?.addEventListener('click', () => {
    if (studentId) router.goToStudentDetails(studentId);
    else router.goToPersonalDashboard();
  });

  document.getElementById('vpLogout')?.addEventListener('click', async () => {
    await authManager.logout();
    router.goToLogin();
  });

  // ── Funções de cálculo ──────────────────────────────────────────

  /**
   * Agrega volume por grupo muscular considerando a distribuição de músculos
   * cadastrada em cada exercício (campos muscles[] com percentuais).
   */
  function computeVolume(workoutData) {
    const result = {};

    DAYS.forEach(day => {
      const exercises = workoutData.days?.[day] || [];
      exercises.forEach((ex, exIdx) => {
        const key     = `${day}_${exIdx}`;
        const sets    = parseInt(ex.sets) || 3;
        const muscles = ex.muscles && ex.muscles.length > 0
          ? ex.muscles
          : [{ group: ex.muscleGroup || ex.muscle || 'Full Body', percentage: 100 }];

        // Pegar override manual se existir
        const overrides = manualPcts[key] || {};

        muscles.forEach(m => {
          const group = m.group || 'Full Body';
          const pct   = typeof overrides[group] !== 'undefined'
            ? overrides[group]
            : (m.percentage || 100);

          if (!result[group]) result[group] = { sets: 0, exercises: 0, pct: 0 };
          result[group].sets      += sets * (pct / 100);
          result[group].exercises += 1 * (pct / 100);
        });
      });
    });

    // Calcular percentuais relativos
    const maxSets = Math.max(...Object.values(result).map(v => v.sets), 1);
    Object.keys(result).forEach(g => {
      result[g].sets      = Math.round(result[g].sets);
      result[g].exercises = Math.round(result[g].exercises * 10) / 10;
      result[g].pct       = Math.round((result[g].sets / maxSets) * 100);
    });

    return result;
  }

  function sortedGroups() {
    return Object.entries(computed)
      .filter(([, v]) => v.sets > 0)
      .sort((a, b) => b[1].sets - a[1].sets);
  }

  function totalSets()      { return Object.values(computed).reduce((s, v) => s + v.sets, 0); }
  function totalExercises() { return Object.values(computed).reduce((s, v) => s + v.exercises, 0); }
  function activeDays()     { return DAYS.filter(d => (workout?.days?.[d] || []).length > 0).length; }
  function muscleGroups()   { return Object.keys(computed).filter(g => computed[g].sets > 0).length; }

  // ── Renderização ──────────────────────────────────────────────

  function render() {
    const root = document.getElementById('vpRoot');
    if (!root) return;

    computed = computeVolume(workout);
    const groups = sortedGroups();

    root.innerHTML = `
      <!-- Hero -->
      <div class="vp-hero">
        <p class="vp-hero-label">Análise de Volume</p>
        <h1 class="vp-hero-title">${esc(workout.name)}</h1>
        <p class="vp-hero-sub">Distribuição semanal por grupo muscular</p>
      </div>

      <!-- Stats -->
      <div class="vp-stats-row">
        <div class="vp-stat">
          <p class="vp-stat-label">Total de Séries</p>
          <p class="vp-stat-value">${totalSets()}</p>
          <p class="vp-stat-sub">séries/semana</p>
        </div>
        <div class="vp-stat">
          <p class="vp-stat-label">Dias ativos</p>
          <p class="vp-stat-value">${activeDays()}</p>
          <p class="vp-stat-sub">dias/semana</p>
        </div>
        <div class="vp-stat">
          <p class="vp-stat-label">Grupos musculares</p>
          <p class="vp-stat-value">${muscleGroups()}</p>
          <p class="vp-stat-sub">grupos trabalhados</p>
        </div>
        <div class="vp-stat">
          <p class="vp-stat-label">Exercícios</p>
          <p class="vp-stat-value">${Math.round(totalExercises())}</p>
          <p class="vp-stat-sub">total/semana</p>
        </div>
      </div>

      <!-- Mode toggle -->
      <div class="vp-mode-row">
        <span class="vp-mode-label">Visualizar por:</span>
        <div class="vp-toggle">
          <button class="vp-toggle-btn ${volumeMode === 'sets' ? 'active' : ''}" data-mode="sets">Séries</button>
          <button class="vp-toggle-btn ${volumeMode === 'exercises' ? 'active' : ''}" data-mode="exercises">Exercícios</button>
        </div>
      </div>

      <!-- Main content -->
      <div class="vp-main">
        <!-- Bar chart -->
        <div>
          <div class="vp-bars-card">
            <p class="vp-bars-title">Volume por grupo muscular</p>
            ${groups.length === 0
              ? '<p style="color:#9CA3AF;font-size:0.875rem;text-align:center;padding:32px 0;">Nenhum exercício com grupo muscular definido.</p>'
              : groups.map(([group, data]) => {
                  const value  = volumeMode === 'sets' ? data.sets : Math.round(data.exercises * 10) / 10;
                  const label  = volumeMode === 'sets' ? `${value} séries` : `${value} exerc.`;
                  const color  = MC_COLORS[group] || '#6B7280';
                  const barPct = data.pct;
                  return `
                    <div class="vp-bar-row">
                      <span class="vp-bar-muscle">${esc(group)}</span>
                      <div class="vp-bar-track">
                        <div class="vp-bar-fill" style="width:${barPct}%;background:${color};"></div>
                      </div>
                      <span class="vp-bar-val" style="color:${color};">${esc(String(value))}</span>
                    </div>`;
                }).join('')}
          </div>

          <!-- Recomendações -->
          ${renderRecommendations(groups)}
        </div>

        <!-- Manual adjustment panel -->
        <div>
          <div class="vp-manual-card">
            <div class="vp-manual-header">
              <span class="vp-manual-title">Ajuste manual de %</span>
              <button class="vp-manual-reset" id="resetManual">Resetar</button>
            </div>
            <div class="vp-manual-body" id="manualBody">
              ${renderManualInputs()}
            </div>
            <button class="vp-recalc" id="recalcBtn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Recalcular
            </button>
          </div>
        </div>
      </div>`;

    // Bind events
    root.querySelectorAll('.vp-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        volumeMode = btn.dataset.mode;
        render();
      });
    });

    document.getElementById('resetManual')?.addEventListener('click', () => {
      manualPcts = {};
      render();
      toast('✓ Porcentagens resetadas');
    });

    document.getElementById('recalcBtn')?.addEventListener('click', () => {
      // Coletar valores dos inputs
      root.querySelectorAll('[data-ex-key][data-muscle-group]').forEach(input => {
        const key   = input.dataset.exKey;
        const group = input.dataset.muscleGroup;
        const val   = parseInt(input.value);
        if (!isNaN(val) && val >= 0 && val <= 100) {
          if (!manualPcts[key]) manualPcts[key] = {};
          manualPcts[key][group] = val;
        }
      });
      render();
      toast('✓ Volume recalculado');
    });
  }

  function renderManualInputs() {
    const rows = [];
    DAYS.forEach((day, dayIdx) => {
      const exercises = workout.days?.[day] || [];
      exercises.forEach((ex, exIdx) => {
        const key     = `${day}_${exIdx}`;
        const muscles = ex.muscles && ex.muscles.length > 0
          ? ex.muscles
          : [{ group: ex.muscleGroup || ex.muscle || 'Full Body', percentage: 100 }];

        rows.push(`
          <div class="vp-ex-item">
            <p class="vp-ex-name">${esc(ex.exerciseName || ex.name || '?')}</p>
            <div class="vp-ex-muscles">
              ${muscles.map(m => {
                const override = manualPcts[key]?.[m.group];
                const val      = typeof override !== 'undefined' ? override : (m.percentage || 100);
                return `
                  <div class="vp-muscle-row">
                    <span class="vp-muscle-name">${esc(m.group)}</span>
                    <input type="number" class="vp-pct-input"
                      data-ex-key="${esc(key)}"
                      data-muscle-group="${esc(m.group)}"
                      value="${esc(String(val))}"
                      min="0" max="100">
                    <span class="vp-pct-label">%</span>
                  </div>`;
              }).join('')}
            </div>
          </div>`);
      });
    });

    return rows.length > 0
      ? rows.join('')
      : '<p style="color:#9CA3AF;font-size:0.875rem;text-align:center;padding:24px 0;">Nenhum exercício com detalhes de músculo.</p>';
  }

  function renderRecommendations(groups) {
    if (groups.length < 2) return '';

    const recommendations = [];

    // Detectar desequilíbrios simples
    const pushGroups = ['Peito', 'Tríceps', 'Ombros'];
    const pullGroups = ['Costas', 'Bíceps'];

    const pushSets = groups.filter(([g]) => pushGroups.includes(g)).reduce((s, [, v]) => s + v.sets, 0);
    const pullSets = groups.filter(([g]) => pullGroups.includes(g)).reduce((s, [, v]) => s + v.sets, 0);

    if (pushSets > 0 && pullSets > 0) {
      const ratio = pushSets / pullSets;
      if (ratio > 1.4) {
        recommendations.push('⚠️ Ratio push:pull elevado (' + ratio.toFixed(1) + ':1). Considere aumentar volume de puxada.');
      } else if (ratio < 0.7) {
        recommendations.push('⚠️ Volume de empurrada baixo em relação à puxada. Considere balancear.');
      } else {
        recommendations.push('✓ Ratio push:pull equilibrado (' + ratio.toFixed(1) + ':1).');
      }
    }

    const legSets = groups.filter(([g]) => ['Pernas', 'Glúteos', 'Quadríceps', 'Posterior'].includes(g))
      .reduce((s, [, v]) => s + v.sets, 0);
    const upperSets = groups.filter(([g]) => !['Pernas', 'Glúteos', 'Quadríceps', 'Posterior', 'Cardio', 'Full Body', 'Abdômen'].includes(g))
      .reduce((s, [, v]) => s + v.sets, 0);

    if (upperSets > 0 && legSets === 0) {
      recommendations.push('⚠️ Nenhum treino de pernas detectado esta semana.');
    } else if (upperSets > 0 && legSets / (upperSets + legSets) < 0.2) {
      recommendations.push('💡 Volume de membros inferiores abaixo de 20% do total.');
    }

    if (recommendations.length === 0) return '';

    return `
      <div style="margin-top:16px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:14px 16px;">
        <p style="font-size:0.72rem;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 8px;">Observações</p>
        ${recommendations.map(r => `<p style="font-size:0.8rem;color:#92400E;margin:0 0 5px;">${esc(r)}</p>`).join('')}
      </div>`;
  }

  function toast(msg, ms = 2200) {
    const el = document.getElementById('vpToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  }

  // ── Inicialização ──────────────────────────────────────────────

  const root = document.getElementById('vpRoot');

  if (!studentId) {
    if (root) root.innerHTML = `
      <div style="text-align:center;padding:80px 20px;">
        <p style="color:#BE123C;font-size:1rem;">ID do aluno não encontrado.</p>
        <button onclick="" id="backToStudents" style="margin-top:16px;padding:10px 20px;background:#0A0A0A;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;">
          Voltar ao dashboard
        </button>
      </div>`;
    document.getElementById('backToStudents')?.addEventListener('click', () => router.goToPersonalDashboard());
    return;
  }

  try {
    // Buscar treinos do aluno
    const workouts = await dbManager.getStudentWorkouts(studentId);

    if (!workouts || workouts.length === 0) {
      if (root) root.innerHTML = `
        <div style="text-align:center;padding:80px 20px;">
          <p style="color:#9CA3AF;font-size:1rem;">Nenhum treino encontrado para este aluno.</p>
        </div>`;
      return;
    }

    // Usar o primeiro treino (ou o mais recente)
    workout = workouts[0];
    render();

  } catch (err) {
    console.error('[volume-analysis] Erro:', err);
    if (root) root.innerHTML = `
      <div style="text-align:center;padding:80px 20px;">
        <p style="color:#BE123C;font-size:1rem;">Erro ao carregar dados: ${esc(err.message)}</p>
      </div>`;
  }
};

window.__pageCleanup = function() {
  // sem globals para limpar
};