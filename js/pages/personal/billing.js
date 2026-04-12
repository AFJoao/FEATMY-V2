/**
 * js/pages/personal/billing.js
 * Migrado de script inline em pages/personal/billing.html
 */
window.__pageInit = async function() {
  await new Promise(r => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', r) : r());
  await new Promise(r => setTimeout(r, 120));

  const PLANS = [
    { id:'starter', name:'Starter', price:'R$ 9,90',  period:'/mês', maxStudents:5,
      features:['Até 5 alunos','Treinos ilimitados','Feedbacks dos alunos','Suporte por e-mail'], popular:false },
    { id:'pro',     name:'Pro',     price:'R$ 19,90', period:'/mês', maxStudents:15,
      features:['Até 15 alunos','Treinos ilimitados','Feedbacks dos alunos','Análise de volume','Suporte prioritário'], popular:true },
    { id:'elite',   name:'Elite',   price:'R$ 49,40', period:'/mês', maxStudents:40,
      features:['Até 40 alunos','Treinos ilimitados','Feedbacks dos alunos','Análise de volume','Relatórios avançados','Suporte VIP'], popular:false },
  ];

  let selectedPlan        = null;
  let currentSubscription = null;
  let pixPollingInterval  = null;
  let currentGatewayPixId = null;
  let pixCopyPaste        = '';
  let validatedCpf        = '';
  let validatedPhone      = '';

  document.getElementById('logoutBtn').onclick = async () => { await authManager.logout(); router.goToLogin(); };

  function toast(msg, ms = 2500) {
    const el = document.getElementById('toastEl');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  }

  async function getToken() {
    const user = authManager.getCurrentUser();
    if (!user) return null;
    return user.getIdToken(); // sem forçar refresh desnecessário
  }

  async function apiFetch(path, options = {}) {
    const token   = await getToken();
    const baseUrl = window.location.origin;
    return fetch(baseUrl + path, {
      ...options,
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, ...(options.headers||{}) },
    });
  }

  function validateCPF(raw) {
    const d = raw.replace(/\D/g,'');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const calc = f => { let s=0; for(let i=0;i<f-1;i++) s+=parseInt(d[i])*(f-i); const r=(s*10)%11; return (r===10||r===11)?0:r; };
    return calc(10)===parseInt(d[9]) && calc(11)===parseInt(d[10]);
  }
  function validatePhone(raw) { const d=raw.replace(/\D/g,''); return d.length===10||d.length===11; }
  function maskCPF(val)   { const d=val.replace(/\D/g,'').slice(0,11); if(d.length<=3)return d; if(d.length<=6)return`${d.slice(0,3)}.${d.slice(3)}`; if(d.length<=9)return`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`; return`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9,11)}`; }
  function maskPhone(val) { const d=val.replace(/\D/g,'').slice(0,11); if(d.length<=2)return d.length?`(${d}`:''; if(d.length<=6)return`(${d.slice(0,2)}) ${d.slice(2)}`; if(d.length<=10)return`(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`; return`(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}`; }

  const inputCpf   = document.getElementById('inputCpf');
  const inputPhone = document.getElementById('inputPhone');
  const hintCpf    = document.getElementById('hintCpf');
  const hintPhone  = document.getElementById('hintPhone');

  if (inputCpf) inputCpf.addEventListener('input', () => {
    inputCpf.value = maskCPF(inputCpf.value);
    const isComplete = inputCpf.value.replace(/\D/g,'').length === 11;
    if (isComplete) {
      const ok = validateCPF(inputCpf.value);
      inputCpf.className = 'cf-input '+(ok?'valid':'invalid');
      if (hintCpf) { hintCpf.className = 'cf-hint '+(ok?'ok':'err'); hintCpf.innerHTML = ok ? '✓ CPF válido' : '✕ CPF inválido'; hintCpf.style.display='flex'; }
    } else { inputCpf.className = 'cf-input'; if (hintCpf) hintCpf.style.display='none'; }
  });

  if (inputPhone) inputPhone.addEventListener('input', () => {
    inputPhone.value = maskPhone(inputPhone.value);
    const digits = inputPhone.value.replace(/\D/g,'');
    if (digits.length >= 10) {
      const ok = validatePhone(inputPhone.value);
      inputPhone.className = 'cf-input '+(ok?'valid':'invalid');
      if (hintPhone) { hintPhone.className = 'cf-hint '+(ok?'ok':'err'); hintPhone.innerHTML = ok ? '✓ Telefone válido' : '✕ Informe DDD + número'; hintPhone.style.display='flex'; }
    } else { inputPhone.className = 'cf-input'; if (hintPhone) hintPhone.style.display='none'; }
  });

  window.confirmCustomerData = function() {
    const errDiv = document.getElementById('cfError');
    if (errDiv) errDiv.style.display = 'none';
    if (!validateCPF(inputCpf?.value || '')) { if(errDiv){errDiv.textContent='CPF inválido.';errDiv.style.display='block';} inputCpf?.focus(); return; }
    if (!validatePhone(inputPhone?.value || '')) { if(errDiv){errDiv.textContent='Telefone inválido.';errDiv.style.display='block';} inputPhone?.focus(); return; }
    validatedCpf   = (inputCpf?.value  || '').replace(/\D/g,'');
    validatedPhone = (inputPhone?.value || '').replace(/\D/g,'');
    const customerFormSection = document.getElementById('customerFormSection');
    if (customerFormSection) customerFormSection.style.display = 'none';
    generatePix();
  };

  window.cancelCustomerForm = function() {
    validatedCpf = ''; validatedPhone = '';
    if (inputCpf)   { inputCpf.value = '';   inputCpf.className   = 'cf-input'; }
    if (inputPhone) { inputPhone.value = ''; inputPhone.className = 'cf-input'; }
    if (hintCpf)   hintCpf.style.display   = 'none';
    if (hintPhone) hintPhone.style.display = 'none';
    const errDiv = document.getElementById('cfError');
    const cfs    = document.getElementById('customerFormSection');
    if (errDiv) errDiv.style.display = 'none';
    if (cfs)    cfs.style.display    = 'none';
    selectedPlan = null;
    renderPlans();
  };

  async function loadStatus() {
    try {
      const res  = await apiFetch('/api/billing/subscription-status');
      const data = await res.json();
      currentSubscription = data;
      renderStatusCard(data);
      renderWarningBanner(data);
    } catch (e) { console.error('[billing] Erro status:', e); }
  }

  function renderStatusCard(sub) {
    const names = { starter:'Starter', pro:'Pro', elite:'Elite' };
    const el = document.getElementById('planName');
    if (el) el.textContent = sub.planId ? `Plano ${names[sub.planId]||sub.planId}` : 'Sem assinatura';
    const badge = document.getElementById('statusBadge');
    if (badge) {
      const map = { active:['s-active','● Ativo'], grace_period:['s-warning','⚠ Carência'], expired:['s-expired','✕ Expirado'], no_subscription:['s-none','— Sem plano'] };
      const [cls, label] = map[sub.status] || ['s-none','—'];
      badge.className = `status-badge ${cls}`; badge.textContent = label;
    }
    if (sub.expiresAt) {
      const d = new Date(sub.expiresAt);
      const fmt = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
      const exp = document.getElementById('expiryText');
      if (exp) exp.textContent = sub.status === 'expired' ? `Expirou em ${fmt}` : `Válida até ${fmt}`;
    }
    const ms = document.getElementById('maxStudentsText');
    const su = document.getElementById('studentsUsedText');
    if (ms) ms.textContent = sub.maxStudents ? 'Limite do plano' : '';
    if (su) su.textContent = sub.maxStudents ? `${sub.maxStudents} alunos` : '';
  }

  function renderWarningBanner(sub) {
    const el = document.getElementById('warningBanner');
    if (!el) return;
    if (!sub.showWarning) { el.style.display='none'; return; }
    const colorMap = { info:{cls:'warn-info',icon:'ℹ️',tc:'#1E40AF'}, warning:{cls:'warn-warning',icon:'⚠️',tc:'#92400E'}, danger:{cls:'warn-danger',icon:'🔒',tc:'#BE123C'} };
    const { cls, icon, tc } = colorMap[sub.warningLevel] || colorMap.info;
    el.className = `warn-banner ${cls}`; el.style.display = 'flex';
    el.innerHTML = `<span style="font-size:1.3rem;flex-shrink:0;">${icon}</span><div style="flex:1;"><p style="font-size:0.875rem;font-weight:700;color:${tc};margin:0 0 4px;">${sub.warningMessage}</p><button onclick="showTab('plans')" style="font-size:0.78rem;font-weight:700;color:${tc};background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;font-family:inherit;">Renovar agora →</button></div>`;
  }

  function renderPlans() {
    const grid    = document.getElementById('plansGrid');
    if (!grid) return;
    const curPlan  = currentSubscription?.planId;
    const isActive = currentSubscription?.status === 'active';
    grid.innerHTML = PLANS.map(p => {
      const isCurrent = curPlan === p.id && isActive;
      const isSel     = selectedPlan === p.id;
      return `<div class="plan-card${p.popular?' popular':''}${isSel?' selected':''}" onclick="selectPlan('${p.id}')">
        ${p.popular ? '<div class="popular-badge">Mais escolhido</div>' : ''}
        <div style="margin-bottom:16px;"><h3 style="font-size:1.05rem;font-weight:800;color:#0A0A0A;margin:0 0 2px;">${p.name}</h3><p style="font-size:0.78rem;color:#6B7280;margin:0;">Até ${p.maxStudents} alunos</p></div>
        <div style="margin-bottom:18px;"><span style="font-size:1.9rem;font-weight:800;color:#0A0A0A;letter-spacing:-0.04em;">${p.price}</span><span style="font-size:0.82rem;color:#9CA3AF;">${p.period}</span></div>
        <ul style="list-style:none;margin:0 0 18px;padding:0;display:flex;flex-direction:column;gap:7px;">${p.features.map(f=>`<li style="font-size:0.78rem;color:#374151;display:flex;align-items:center;gap:6px;"><span style="color:#00C853;">✓</span>${f}</li>`).join('')}</ul>
        <button onclick="event.stopPropagation();openCustomerForm('${p.id}')" style="width:100%;padding:11px;border:2px solid ${isSel?'#00E676':'#E5E7EB'};background:${isSel?'#00E676':'#fff'};color:${isSel?'#0A0A0A':'#374151'};border-radius:10px;font-size:0.85rem;font-weight:700;cursor:pointer;transition:all 0.2s;font-family:inherit;">
          ${isCurrent ? '✓ Plano atual — Renovar' : 'Assinar agora'}
        </button>
      </div>`;
    }).join('');
  }

  window.selectPlan = function(planId) { selectedPlan = planId; renderPlans(); };

  window.openCustomerForm = function(planId) {
    selectedPlan = planId; renderPlans();
    if (inputCpf)   { inputCpf.value   = ''; inputCpf.className   = 'cf-input'; }
    if (inputPhone) { inputPhone.value = ''; inputPhone.className = 'cf-input'; }
    if (hintCpf)    hintCpf.style.display   = 'none';
    if (hintPhone)  hintPhone.style.display = 'none';
    const errDiv = document.getElementById('cfError');
    const px     = document.getElementById('pixSection');
    const cfs    = document.getElementById('customerFormSection');
    if (errDiv) errDiv.style.display = 'none';
    if (px)     px.style.display     = 'none';
    if (cfs)    { cfs.style.display  = 'block'; cfs.scrollIntoView({ behavior:'smooth', block:'start' }); }
    setTimeout(() => inputCpf?.focus(), 300);
  };

  async function generatePix() {
    const plan = PLANS.find(p => p.id === selectedPlan);
    if (!plan) return;
    const pixSection  = document.getElementById('pixSection');
    const pixPlanLabel = document.getElementById('pixPlanLabel');
    const pixQRC      = document.getElementById('pixQRContainer');
    const pixCodeText = document.getElementById('pixCodeText');
    const simPayBtn   = document.getElementById('simPayBtn');
    if (pixSection)  pixSection.style.display  = 'block';
    if (pixPlanLabel) pixPlanLabel.textContent  = `${plan.name} — ${plan.price}/mês`;
    if (pixQRC)       pixQRC.innerHTML          = '<div class="spinner"></div>';
    if (pixCodeText)  pixCodeText.textContent   = 'Gerando código PIX...';
    if (simPayBtn)    simPayBtn.disabled        = true;
    pixSection?.scrollIntoView({ behavior:'smooth', block:'start' });

    try {
      const res  = await apiFetch('/api/billing/create-charge', { method:'POST', body: JSON.stringify({ planId: selectedPlan, cpf: validatedCpf, phone: validatedPhone }) });
      const data = await res.json();
      if (!res.ok) { showPixError(data.error || 'Erro ao gerar cobrança'); return; }
      currentGatewayPixId = data.gatewayPixId || '';
      pixCopyPaste        = data.pixCopyPaste  || '';
      if (data.expiresAt) {
        const diff = Math.round((new Date(data.expiresAt) - Date.now()) / 60000);
        const pet  = document.getElementById('pixExpiryText');
        if (pet) pet.textContent = `Código válido por ${diff} minutos`;
      }
      if (pixQRC) {
        if (data.pixBase64) pixQRC.innerHTML = `<img src="${data.pixBase64}" alt="QR Code PIX" style="width:100%;height:100%;object-fit:contain;border-radius:8px;">`;
        else if (pixCopyPaste) pixQRC.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(pixCopyPaste)}" alt="QR Code PIX" style="width:100%;height:100%;object-fit:contain;border-radius:8px;">`;
        else pixQRC.innerHTML = '<span style="font-size:2rem;">📋</span>';
      }
      if (pixCodeText) pixCodeText.textContent = pixCopyPaste || '—';
      if (simPayBtn)   simPayBtn.disabled       = !currentGatewayPixId;
      startPolling();
    } catch (e) { showPixError('Erro de conexão. Tente novamente.'); }
  }

  function showPixError(msg) {
    const pixQRC      = document.getElementById('pixQRContainer');
    const pixCodeText = document.getElementById('pixCodeText');
    const simPayBtn   = document.getElementById('simPayBtn');
    if (pixQRC)      pixQRC.innerHTML         = '<span style="font-size:2rem;">❌</span>';
    if (pixCodeText) pixCodeText.textContent  = msg;
    if (simPayBtn)   simPayBtn.disabled       = true;
  }

  window.simulatePayment = async function() {
    if (!currentGatewayPixId) return;
    const btn = document.getElementById('simPayBtn');
    if (!btn) return;
    btn.disabled = true; btn.innerHTML = '⏳ Processando...';
    try {
      const res  = await apiFetch('/api/billing/simulate-payment', { method:'POST', body: JSON.stringify({ gatewayPixId: currentGatewayPixId }) });
      const json = await res.json();
      if (res.ok && json.success && json.activated) {
        btn.innerHTML = '✓ Pagamento ativado!';
        toast('✓ Assinatura ativada! Atualizando...', 3000);
        await new Promise(r => setTimeout(r, 800));
        const statusRes  = await apiFetch('/api/billing/subscription-status');
        const statusData = await statusRes.json();
        if (statusData.status === 'active') { clearInterval(pixPollingInterval); onPaymentConfirmed(statusData); }
      } else {
        btn.innerHTML = '🧪 Simular pagamento PIX (Dev Mode)'; btn.disabled = false;
        toast('Erro: ' + (json.error || 'tente novamente'));
      }
    } catch (e) {
      btn.innerHTML = '🧪 Simular pagamento PIX (Dev Mode)'; btn.disabled = false;
      toast('Erro ao simular: ' + e.message);
    }
  };

  function startPolling() {
    clearInterval(pixPollingInterval);
    let attempts = 0;
    pixPollingInterval = setInterval(async () => {
      attempts++;
      if (attempts > 72) { clearInterval(pixPollingInterval); return; }
      try {
        const res  = await apiFetch('/api/billing/subscription-status');
        const data = await res.json();
        if (data.status === 'active') { clearInterval(pixPollingInterval); onPaymentConfirmed(data); }
      } catch { /* ignora */ }
    }, 5000);
  }

  function onPaymentConfirmed(sub) {
    currentSubscription = sub;
    validatedCpf   = ''; validatedPhone = '';
    const ps  = document.getElementById('pixSection');
    const cfs = document.getElementById('customerFormSection');
    if (ps)  ps.style.display  = 'none';
    if (cfs) cfs.style.display = 'none';
    renderStatusCard(sub); renderWarningBanner(sub); renderPlans();
    toast('🎉 Pagamento confirmado! Plano ativado.', 5000);
  }

  window.cancelPix = function() {
    clearInterval(pixPollingInterval);
    validatedCpf = ''; validatedPhone = '';
    const ps  = document.getElementById('pixSection');
    const cfs = document.getElementById('customerFormSection');
    if (ps)  ps.style.display  = 'none';
    if (cfs) cfs.style.display = 'none';
    selectedPlan = null; renderPlans();
  };

  window.copyPix = function() {
    if (!pixCopyPaste) return;
    navigator.clipboard.writeText(pixCopyPaste).then(() => {
      const btn = document.getElementById('copyPixBtn');
      if (!btn) return;
      btn.innerHTML = '✓ Copiado!'; btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = '📋 Copiar código PIX'; btn.classList.remove('copied'); }, 3000);
    });
  };

  window.showTab = function(tab) {
    const cp  = document.getElementById('contentPlans');
    const ch  = document.getElementById('contentHistory');
    const tp  = document.getElementById('tabPlans');
    const th  = document.getElementById('tabHistory');
    if (cp) cp.style.display = tab === 'plans'   ? 'block' : 'none';
    if (ch) ch.style.display = tab === 'history' ? 'block' : 'none';
    if (tp) tp.className = 'tab-btn' + (tab === 'plans'   ? ' active' : '');
    if (th) th.className = 'tab-btn' + (tab === 'history' ? ' active' : '');
    if (tab === 'history') loadHistory();
  };

  async function loadHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    try {
      const user = authManager.getCurrentUser();
      if (!user) return;
      const snap = await db.collection('billings').where('personalId','==',user.uid).orderBy('createdAt','desc').limit(20).get();
      if (snap.empty) { list.innerHTML = `<div style="text-align:center;padding:48px;color:#9CA3AF;">Nenhuma cobrança ainda.</div>`; return; }
      const sLabel = { pending:'Aguardando', paid:'Pago', expired:'Expirado' };
      const sColor = { pending:'#F59E0B',   paid:'#059669', expired:'#DC2626' };
      list.innerHTML = `<div style="background:#fff;border:1px solid #EBEBEB;border-radius:16px;overflow:hidden;"><div style="padding:16px 20px;border-bottom:1px solid #F4F4F4;"><h3 style="font-size:0.95rem;font-weight:700;color:#0A0A0A;margin:0;">Histórico de cobranças</h3></div><div style="padding:0 20px;">${snap.docs.map(doc => {
        const b    = doc.data();
        const date = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleDateString('pt-BR') : '—';
        const amt  = b.amountInCents ? `R$ ${(b.amountInCents/100).toFixed(2).replace('.',',')}` : '—';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #F4F4F4;"><div><p style="font-size:0.875rem;font-weight:600;color:#0A0A0A;margin:0 0 2px;">Plano ${b.planName||b.planId}</p><p style="font-size:0.75rem;color:#9CA3AF;margin:0;">${date} · ${b.billingPeriod}</p></div><div style="text-align:right;"><p style="font-size:0.875rem;font-weight:700;color:#0A0A0A;margin:0 0 3px;">${amt}</p><span style="font-size:0.7rem;font-weight:700;color:${sColor[b.status]||'#6B7280'};">● ${sLabel[b.status]||b.status}</span></div></div>`;
      }).join('')}</div></div>`;
    } catch { if (list) list.innerHTML = `<p style="color:#DC2626;text-align:center;padding:32px;">Erro ao carregar histórico.</p>`; }
  }

  renderPlans();
  await loadStatus();
  renderPlans();
};

window.__pageCleanup = function() {
  delete window.confirmCustomerData;
  delete window.cancelCustomerForm;
  delete window.selectPlan;
  delete window.openCustomerForm;
  delete window.simulatePayment;
  delete window.cancelPix;
  delete window.copyPix;
  delete window.showTab;
};
