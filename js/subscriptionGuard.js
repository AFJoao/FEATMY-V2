/**
 * js/subscriptionGuard.js
 *
 * CORREÇÕES v3:
 * - getIdToken(true) substituído por getIdToken() — o refresh forçado
 *   a cada verificação causava latência desnecessária e podia ser a causa
 *   do ERR_BLOCKED_BY_CLIENT (muitas requisições ao Firebase em rápida
 *   sucessão). O token só precisa ser refreshado quando próximo de expirar,
 *   o que o Firebase SDK já faz automaticamente sem força.
 * - Banner de aviso agora é removido corretamente quando a página muda
 *   (destroy() também remove o banner do DOM).
 * - Cache de 5 min mantido para evitar chamadas repetidas à API.
 * - setInterval de recheck agora usa referência estável para poder ser
 *   limpo corretamente no destroy().
 */

class SubscriptionGuard {
  constructor() {
    this.status        = null;
    this.checkInterval = null;
    this._initialized  = false;
    this._lastCheckAt  = 0;
    this._cacheTTL     = 5 * 60 * 1000; // 5 minutos
    this._bannerId     = 'sub-warning-banner';
  }

  _isCacheValid() {
    return this.status !== null &&
      (Date.now() - this._lastCheckAt) < this._cacheTTL;
  }

  invalidateCache() {
    this._lastCheckAt = 0;
    this.status = null;
  }

  async checkStatus(forceRefresh = false) {
    if (!forceRefresh && this._isCacheValid()) {
      return this.status;
    }

    try {
      const user = authManager?.getCurrentUser?.();
      if (!user) return null;

      // Sem forceRefresh no getIdToken — o SDK gerencia a renovação automaticamente
      const token = await user.getIdToken();
      const res   = await fetch('/api/billing/subscription-status', {
        headers: { 'Authorization': `Bearer ${token}` },
        cache:   'no-store',
      });

      if (!res.ok) {
        console.warn('[subscriptionGuard] API retornou', res.status);
        return null;
      }

      this.status      = await res.json();
      this._lastCheckAt = Date.now();
      return this.status;
    } catch (e) {
      console.warn('[subscriptionGuard] Erro ao verificar status:', e.message);
      return null;
    }
  }

  async init() {
    if (this._initialized && this._isCacheValid()) {
      if (this.status?.showWarning) this._showWarningBanner(this.status);
      if (!this.status?.isActive)   this._applyReadOnlyMode();
      window._subscriptionMaxStudents = this.status?.maxStudents || 0;
      window._subscriptionPlanId      = this.status?.planId      || null;
      window._subscriptionIsActive    = this.status?.isActive    || false;
      return this.status;
    }

    this._initialized = true;

    const status = await this.checkStatus();
    if (!status) return null;

    if (status.showWarning) {
      this._showWarningBanner(status);
    }

    if (!status.isActive) {
      this._applyReadOnlyMode();
    }

    window._subscriptionMaxStudents = status.maxStudents || 0;
    window._subscriptionPlanId      = status.planId      || null;
    window._subscriptionIsActive    = status.isActive    || false;

    // Recheck a cada 5 minutos
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(async () => {
      const updated = await this.checkStatus(true);
      if (!updated) return;

      const wasInactive = !this.status?.isActive;
      const nowActive   = updated.status === 'active';

      if (wasInactive && nowActive) {
        window.location.reload();
        return;
      }

      this.status = updated;
    }, 5 * 60 * 1000);

    return status;
  }

  _showWarningBanner(status) {
    // Não duplicar banner
    if (document.getElementById(this._bannerId)) return;

    const colorMap = {
      info:    { bg: '#EFF6FF', border: '#BFDBFE', text: '#1E40AF', icon: 'ℹ️' },
      warning: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '⚠️' },
      danger:  { bg: '#FFF1F2', border: '#FECDD3', text: '#BE123C', icon: '🔒' },
    };
    const c = colorMap[status.warningLevel] || colorMap.info;

    const banner = document.createElement('div');
    banner.id = this._bannerId;
    banner.style.cssText = `
      position:fixed; bottom:0; left:0; right:0; z-index:9999;
      background:${c.bg}; border-top:2px solid ${c.border};
      padding:12px 20px; display:flex; align-items:center;
      justify-content:space-between; gap:12px;
      font-family:'DM Sans',system-ui,sans-serif;
      box-shadow:0 -4px 20px rgba(0,0,0,0.08);
    `;
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <span style="font-size:1.1rem;flex-shrink:0;">${c.icon}</span>
        <p style="font-size:0.82rem;font-weight:600;color:${c.text};margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${status.warningMessage}
        </p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
        <a href="#/personal/billing"
          style="padding:7px 14px;background:${c.text};color:#fff;border-radius:8px;font-size:0.78rem;font-weight:700;text-decoration:none;white-space:nowrap;">
          Renovar agora
        </a>
        ${status.warningLevel === 'info' ? `
          <button onclick="document.getElementById('${this._bannerId}').style.display='none'"
            style="background:transparent;border:none;color:${c.text};cursor:pointer;font-size:1.3rem;opacity:0.6;padding:0 4px;">×</button>
        ` : ''}
      </div>
    `;
    document.body.appendChild(banner);
  }

  _applyReadOnlyMode() {
    const apply = () => {
      const selectors = [
        '#addStudentBtn',
        '#saveWorkoutBtn',
        '#createWorkoutBtn',
        '#openAddExerciseModal',
        '#saveExerciseBtn',
        '#createStudentBtn',
        'button[data-action="deactivate"]',
        'button[data-action="reactivate"]',
        'button[data-action="delete"]',
      ];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(btn => {
          btn.disabled            = true;
          btn.title               = 'Renove sua assinatura para usar este recurso';
          btn.style.opacity       = '0.4';
          btn.style.cursor        = 'not-allowed';
          btn.style.pointerEvents = 'none';
        });
      });

      document.querySelectorAll(
        'a[href="#/personal/create-workout"], a[href="#/personal/exercises"]'
      ).forEach(link => {
        link.addEventListener('click', e => {
          e.preventDefault();
          this._showUpgradeModal();
        });
      });
    };

    apply();
    setTimeout(apply, 800);
    setTimeout(apply, 2500);
  }

  _showUpgradeModal() {
    const existing = document.getElementById('upgrade-modal');
    if (existing) { existing.style.display = 'flex'; return; }

    const modal = document.createElement('div');
    modal.id = 'upgrade-modal';
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.6);
      backdrop-filter:blur(4px); z-index:10000;
      display:flex; align-items:center; justify-content:center; padding:20px;
      font-family:'DM Sans',system-ui,sans-serif;
    `;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:32px;max-width:380px;width:100%;text-align:center;">
        <div style="width:56px;height:56px;background:#FFF1F2;border-radius:14px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;">🔒</div>
        <h3 style="font-size:1.2rem;font-weight:800;color:#0A0A0A;margin:0 0 8px;">Assinatura necessária</h3>
        <p style="font-size:0.875rem;color:#6B7280;margin:0 0 8px;line-height:1.6;">
          Sua assinatura expirou. Renove para voltar a criar treinos, adicionar alunos e acessar todos os recursos.
        </p>
        <p style="font-size:0.78rem;color:#9CA3AF;margin:0 0 20px;">Os dados dos seus alunos estão preservados.</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a href="#/personal/billing"
            onclick="document.getElementById('upgrade-modal').style.display='none'"
            style="display:block;padding:13px;background:#00E676;color:#0A0A0A;border-radius:12px;font-size:0.9rem;font-weight:800;text-decoration:none;">
            Ver planos e renovar
          </a>
          <button onclick="document.getElementById('upgrade-modal').style.display='none'"
            style="padding:11px;background:#F4F4F4;border:none;border-radius:12px;font-size:0.85rem;font-weight:600;color:#374151;cursor:pointer;font-family:inherit;">
            Fechar
          </button>
        </div>
      </div>
    `;
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  canAddStudent(currentCount) {
    if (!this.status) return true;
    if (!this.status.isActive) return false;
    return currentCount < (this.status.maxStudents || 0);
  }

  destroy() {
    clearInterval(this.checkInterval);
    this.checkInterval = null;
    this._initialized  = false;
    this._lastCheckAt  = 0;
    this.status        = null;

    // Remover banner do DOM ao destruir (evita banner órfão ao trocar de página)
    const banner = document.getElementById(this._bannerId);
    if (banner) banner.remove();
  }
}

const subscriptionGuard = new SubscriptionGuard();
window.subscriptionGuard = subscriptionGuard;