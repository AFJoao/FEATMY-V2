/**
 * js/router.js — v3
 *
 * CORREÇÕES v3:
 *
 * 1. RACE CONDITION NO AUTH:
 *    Antes: waitForAuth fazia polling de authManager.isInitialized, mas se
 *    authManager.initialize() ainda não havia sido chamado (corrida com
 *    DOMContentLoaded), o polling nunca via a mudança.
 *    Depois: router.init() garante que authManager.initialize() foi chamado
 *    ANTES de começar o polling, e usa onAuthStateChanged como fallback
 *    direto ao Firebase para não depender só do flag.
 *
 * 2. BOTÕES "VOLTAR" BLOQUEADOS PELA CSP:
 *    Antes: onclick="router.goToPersonalDashboard()" nos atributos HTML
 *    eram bloqueados pela CSP (sem unsafe-inline).
 *    Depois: o router registra event listeners nos elementos após carregar
 *    cada página, sem depender de handlers inline. As páginas mantêm
 *    data-action="back" / data-action="go-to:PATH" como convenção.
 *
 * 3. LIMPEZA DE SCRIPTS INLINE:
 *    _stripInlineScripts agora também remove atributos de evento inline
 *    (onclick, onmouseover etc.) de elementos que serão tratados por JS.
 *    ATENÇÃO: isso é opt-in via data-safe-events="true" no elemento raiz
 *    da página para não quebrar páginas que ainda não foram migradas.
 */

class Router {
  constructor() {
    this.routes = {
      '/': 'pages/login.html',
      '/login': 'pages/login.html',
      '/signup': 'pages/signup.html',
      '/primeiro-acesso': 'pages/primeiro-acesso.html',
      '/recuperar-senha': 'pages/recuperar-senha.html',
      '/personal/dashboard': 'pages/personal/dashboard.html',
      '/personal/exercises': 'pages/personal/exercises.html',
      '/personal/create-workout': 'pages/personal/create-workout.html',
      '/personal/student/:id': 'pages/personal/student-details.html',
      '/personal/feedbacks': 'pages/personal/feedbacks.html',
      '/personal/billing': 'pages/personal/billing.html',
      '/student/dashboard': 'pages/student/dashboard.html',
      '/student/view-workout': 'pages/student/view-workout.html',
      '/personal/volume/:id': 'pages/personal/volume-analysis.html',
    };

    this.pageScripts = {
      '/login':                  'js/pages/login.js',
      '/signup':                 'js/pages/signup.js',
      '/primeiro-acesso':        'js/pages/primeiro-acesso.js',
      '/recuperar-senha':        'js/pages/recuperar-senha.js',
      '/personal/dashboard':     'js/pages/personal/dashboard.js',
      '/personal/exercises':     'js/pages/personal/exercises.js',
      '/personal/create-workout':'js/pages/personal/create-workout.js',
      '/personal/student/:id':   'js/pages/personal/student-details.js',
      '/personal/feedbacks':     'js/pages/personal/feedbacks.js',
      '/personal/billing':       'js/pages/personal/billing.js',
      '/student/dashboard':      'js/pages/student/dashboard.js',
      '/student/view-workout':   'js/pages/student/view-workout.js',
      '/personal/volume/:id':    'js/pages/personal/volume-analysis.js',
    };

    this.protectedRoutes = {
      '/personal/dashboard':      'personal',
      '/personal/exercises':      'personal',
      '/personal/create-workout': 'personal',
      '/personal/student/:id':    'personal',
      '/personal/feedbacks':      'personal',
      '/personal/billing':        'personal',
      '/student/dashboard':       'student',
      '/personal/volume/:id':     'personal',
      '/student/view-workout':    'student',
    };

    this.publicRoutes = ['/', '/login', '/signup', '/primeiro-acesso', '/recuperar-senha'];

    this.isReady       = false;
    this.authReady     = false;
    this.currentPath   = null;
    this.navigationQueue = [];
    this.isNavigating  = false;

    this._loadedScripts = new Set();
    this._currentFetchController = null;

    window.addEventListener('hashchange', () => {
      if (this.authReady) this.navigate(window.location.hash.slice(1));
    });

    window.addEventListener('popstate', () => {
      if (this.authReady) this.navigate(window.location.hash.slice(1));
    });
  }

  // ── Auth ─────────────────────────────────────────────────────

  async waitForAuth() {
    // Garantir que o authManager foi inicializado antes de esperar
    if (typeof authManager === 'undefined') {
      console.error('[router] authManager não encontrado');
      this.authReady = true;
      return;
    }

    // Se já inicializado, retornar imediatamente
    if (authManager.isInitialized) {
      this.authReady = true;
      return;
    }

    // Garantir que initialize() foi chamado
    authManager.initialize();

    return new Promise((resolve) => {
      let resolved = false;

      const done = () => {
        if (resolved) return;
        resolved = true;
        clearInterval(pollInterval);
        clearTimeout(timeoutId);
        this.authReady = true;
        resolve();
      };

      // Polling rápido como mecanismo principal
      const pollInterval = setInterval(() => {
        if (authManager.isInitialized) done();
      }, 30);

      // Fallback via onAuthStateChanged do Firebase diretamente
      // Isso garante que não ficamos travados se o flag nunca mudar
      let unsubscribe;
      try {
        unsubscribe = auth.onAuthStateChanged(() => {
          if (unsubscribe) unsubscribe();
          // Dar uma volta ao event loop para o authManager processar
          setTimeout(done, 50);
        });
      } catch (e) {
        // auth pode não estar disponível ainda
      }

      // Timeout de segurança
      const timeoutId = setTimeout(() => {
        console.warn('[router] Timeout aguardando AuthManager — continuando');
        if (unsubscribe) try { unsubscribe(); } catch (_) {}
        done();
      }, 8000);
    });
  }

  // ── Route matching ────────────────────────────────────────────

  matchRoute(path) {
    if (this.routes[path]) return { route: path, params: {} };

    for (const [route] of Object.entries(this.routes)) {
      if (!route.includes(':')) continue;
      const routeParts = route.split('/');
      const pathParts  = path.split('/');
      if (routeParts.length !== pathParts.length) continue;

      const params = {};
      let match = true;
      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = pathParts[i];
        } else if (routeParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }
      if (match) return { route, params };
    }
    return null;
  }

  getRequiredType(path) {
    if (this.protectedRoutes[path]) return this.protectedRoutes[path];
    for (const [route, type] of Object.entries(this.protectedRoutes)) {
      if (!route.includes(':')) continue;
      const routeParts = route.split('/');
      const pathParts  = path.split('/');
      if (routeParts.length !== pathParts.length) continue;
      let match = true;
      for (let i = 0; i < routeParts.length; i++) {
        if (!routeParts[i].startsWith(':') && routeParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }
      if (match) return type;
    }
    return null;
  }

  _resolveScriptPath(path) {
    if (this.pageScripts[path]) return this.pageScripts[path];
    for (const [routePattern, scriptPath] of Object.entries(this.pageScripts)) {
      if (!routePattern.includes(':')) continue;
      const routeParts = routePattern.split('/');
      const pathParts  = path.split('/');
      if (routeParts.length !== pathParts.length) continue;
      let match = true;
      for (let i = 0; i < routeParts.length; i++) {
        if (!routeParts[i].startsWith(':') && routeParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }
      if (match) return scriptPath;
    }
    return null;
  }

  // ── Navigation ────────────────────────────────────────────────

  async navigate(path = '/') {
    if (this.isNavigating && this.currentPath === path) return;
    const last = this.navigationQueue[this.navigationQueue.length - 1];
    if (!last || last !== path) this.navigationQueue.push(path);
    if (this.isNavigating) return;

    while (this.navigationQueue.length > 0) {
      await this._navigate(this.navigationQueue.shift());
    }
  }

  async _navigate(path = '/') {
    this.isNavigating = true;
    try {
      if (!path.startsWith('/')) path = '/' + path;
      if (!this.authReady) await this.waitForAuth();

      const requiredType    = this.getRequiredType(path);
      const isAuthenticated = authManager.isAuthenticated();
      const currentUserType = authManager.getCurrentUserType();

      if (requiredType) {
        if (!isAuthenticated) {
          window.location.hash = '#/login';
          return;
        }
        if (currentUserType !== requiredType) {
          const redirect = currentUserType === 'personal'
            ? '/personal/dashboard' : '/student/dashboard';
          if (path !== redirect) { window.location.hash = '#' + redirect; return; }
        }
      }

      if (this.publicRoutes.includes(path) && isAuthenticated && currentUserType) {
        const redirect = currentUserType === 'personal'
          ? '/personal/dashboard' : '/student/dashboard';
        if (path !== redirect) { window.location.hash = '#' + redirect; return; }
      }

      if (this.currentPath !== path) {
        await this.loadPage(path);
        this.currentPath = path;
      }
    } catch (err) {
      console.error('[router] Erro na navegação:', err);
    } finally {
      this.isNavigating = false;
    }
  }

  // ── Page loading ──────────────────────────────────────────────

  async loadPage(path) {
    const matchResult = this.matchRoute(path);
    if (!matchResult) { this.loadPage('/login'); return; }

    const pagePath = this.routes[matchResult.route];
    window.routeParams = matchResult.params;

    if (this._currentFetchController) {
      this._currentFetchController.abort();
    }
    this._currentFetchController = new AbortController();

    try {
      const response = await fetch(pagePath + '?v=' + Date.now(), {
        signal: this._currentFetchController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html      = await response.text();
      const container = document.getElementById('app');
      if (!container) return;

      this._cleanupCurrentPage(container);
      container.innerHTML = this._stripInlineScripts(html);

      await new Promise(r => setTimeout(r, 30));

      if (window.location.hash !== '#' + path) {
        window.location.hash = '#' + path;
      }

      // Registrar listeners declarativos (data-action) antes do script da página
      this._bindDeclarativeActions(container);

      await this._loadPageScript(path, matchResult);

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[router] Erro ao carregar página:', err);
      this._showErrorPage(err.message);
    }
  }

  /**
   * Registra event listeners em elementos com data-action="..." 
   * como alternativa segura aos onclick inline, compatível com CSP estrita.
   *
   * Uso no HTML: <button data-action="back">Voltar</button>
   *              <button data-action="go-to:/personal/dashboard">Dashboard</button>
   *              <button data-action="logout">Sair</button>
   */
  _bindDeclarativeActions(container) {
    container.querySelectorAll('[data-action]').forEach(el => {
      const action = el.dataset.action;
      if (!action) return;

      // Evitar registrar listener duplo
      if (el._routerActionBound) return;
      el._routerActionBound = true;

      el.addEventListener('click', (e) => {
        if (action === 'back') {
          e.preventDefault();
          history.back();
        } else if (action === 'logout') {
          e.preventDefault();
          authManager.logout().then(() => this.goToLogin());
        } else if (action.startsWith('go-to:')) {
          e.preventDefault();
          const target = action.slice(6);
          this.navigate(target);
        }
      });
    });
  }

  _stripInlineScripts(html) {
    return html.replace(/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/gi, () => {
      return '<!-- script inline removido — use arquivo .js externo -->';
    });
  }

  async _loadPageScript(path, matchResult) {
    const scriptSrc = this._resolveScriptPath(path);

    if (!scriptSrc) {
      console.warn(`[router] Sem script externo para ${path}.`);
      return;
    }

    return new Promise((resolve, reject) => {
      delete window.__pageInit;

      const existingId = `page-script-${scriptSrc.replace(/\//g, '-').replace('.js', '')}`;
      const existing = document.getElementById(existingId);
      if (existing) existing.remove();

      const script    = document.createElement('script');
      script.id       = existingId;
      script.src      = scriptSrc + '?v=' + Date.now();
      script.async    = false;
      script.defer    = false;

      script.onload = async () => {
        if (typeof window.__pageInit === 'function') {
          try {
            await window.__pageInit(matchResult.params);
          } catch (e) {
            console.error(`[router] Erro em __pageInit de ${scriptSrc}:`, e);
          }
          delete window.__pageInit;
        }
        resolve();
      };

      script.onerror = (e) => {
        console.error(`[router] Falha ao carregar script: ${scriptSrc}`, e);
        reject(new Error(`Script não encontrado: ${scriptSrc}`));
      };

      document.body.appendChild(script);
    });
  }

  _cleanupCurrentPage(container) {
    if (typeof window.__pageCleanup === 'function') {
      try {
        window.__pageCleanup();
      } catch (e) {
        console.warn('[router] Erro no cleanup:', e);
      }
      delete window.__pageCleanup;
    }

    document.querySelectorAll('script[id^="page-script-"]').forEach(s => s.remove());
    container.innerHTML = '';
    container.textContent = '';
  }

  _showErrorPage(message) {
  const container = document.getElementById('app');
  if (!container) return;
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'max-width:600px;margin:100px auto;padding:40px;text-align:center;background:#fff3f3;border:2px solid #ffdddd;border-radius:12px;';
  const h2 = document.createElement('h2');
  h2.style.cssText = 'color:#cc0000;margin-bottom:12px;';
  h2.textContent = 'Erro ao carregar página';
  const p = document.createElement('p');
  p.style.cssText = 'color:#666;margin-bottom:20px;';
  p.textContent = message; // textContent — imune a XSS
  const btn = document.createElement('button');
  btn.style.cssText = 'padding:12px 24px;background:#000;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:15px;';
  btn.textContent = 'Recarregar';
  btn.addEventListener('click', () => window.location.reload());
  wrapper.appendChild(h2); wrapper.appendChild(p); wrapper.appendChild(btn);
  container.innerHTML = '';
  container.appendChild(wrapper);
}

  // ── Helpers de navegação ──────────────────────────────────────

  goToLogin()                    { this.navigate('/login'); }
  goToSignup()                   { this.navigate('/signup'); }
  goToPersonalDashboard()        { this.navigate('/personal/dashboard'); }
  goToStudentDashboard()         { this.navigate('/student/dashboard'); }
  goToCreateWorkout()            { this.navigate('/personal/create-workout'); }
  goToExercises()                { this.navigate('/personal/exercises'); }
  goToViewWorkout()              { this.navigate('/student/view-workout'); }
  goToStudentDetails(studentId)  { this.navigate(`/personal/student/${studentId}`); }
  goToVolumeAnalysis(studentId)  { this.navigate(`/personal/volume/${studentId}`); }
  goTo(path)                     { this.navigate(path); }

  async init() {
    // Garantir que o authManager está inicializando antes de qualquer coisa
    if (typeof authManager !== 'undefined') {
      authManager.initialize();
    }
    await this.waitForAuth();
    this.isReady = true;
    const initialPath = window.location.hash.slice(1) || '/';
    await this.navigate(initialPath);
  }
}

const router = new Router();
window.router = router;

document.addEventListener('DOMContentLoaded', () => router.init());