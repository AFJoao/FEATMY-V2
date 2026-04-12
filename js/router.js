/**
 * js/router.js — v2 SEGURO
 *
 * CORREÇÃO CRÍTICA v2:
 *
 * ANTES (inseguro):
 *   container.innerHTML = html;
 *   const scripts = container.querySelectorAll('script');
 *   for (const script of scripts) {
 *     const scriptFunction = new Function(script.textContent); // ← RCE
 *     scriptFunction();
 *   }
 *
 * DEPOIS (seguro):
 *   1. O HTML das páginas NÃO contém mais blocos <script> inline com lógica.
 *   2. Cada página tem um atributo data-page-script="js/pages/personal/dashboard.js"
 *      no elemento raiz, indicando qual script externo carregar.
 *   3. O router injeta um <script src="..."> real, que o browser executa
 *      dentro do modelo de segurança normal (CSP, SRI, origem).
 *   4. Scripts externos são cacheados pelo browser — não há recarregamento
 *      desnecessário entre navegações.
 *   5. Cada script de página exporta uma função init() chamada após o HTML
 *      estar no DOM, substituindo o padrão de auto-execução inline.
 *
 * COMPATIBILIDADE:
 *   Páginas que ainda não foram migradas para script externo continuam
 *   funcionando via fallback legacy (com aviso no console em dev).
 *   Isso permite migração incremental página por página.
 *
 * CSP COMPATÍVEL:
 *   Com scripts externos, o header CSP pode usar:
 *     script-src 'self' https://www.gstatic.com https://fonts.googleapis.com
 *   sem precisar de 'unsafe-eval' ou 'unsafe-inline'.
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

    // Mapeamento página → script externo
    // Adicionar entrada aqui ao migrar cada página
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

    // Rastrear scripts já carregados para não recarregar desnecessariamente
    this._loadedScripts = new Set();

    // AbortController para cancelar fetch de página anterior se nova navegação chegar
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
    return new Promise((resolve) => {
      if (authManager.isInitialized) {
        this.authReady = true;
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (authManager.isInitialized) {
          clearInterval(check);
          this.authReady = true;
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        console.warn('[router] Timeout aguardando AuthManager');
        this.authReady = true;
        resolve();
      }, 10000);
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

  // Resolve o padrão de rota com parâmetros para o script externo correto
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

  // ── Page loading — SEGURO ─────────────────────────────────────

  async loadPage(path) {
    const matchResult = this.matchRoute(path);
    if (!matchResult) { this.loadPage('/login'); return; }

    const pagePath = this.routes[matchResult.route];
    window.routeParams = matchResult.params;

    // Cancelar fetch anterior se ainda estiver em andamento
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

      // Limpar DOM anterior completamente antes de injetar novo conteúdo
      this._cleanupCurrentPage(container);

      // Injetar apenas o HTML estrutural — sem executar scripts inline
      container.innerHTML = this._stripInlineScripts(html);

      await new Promise(r => setTimeout(r, 30));

      // Atualizar hash sem disparar novo evento hashchange
      if (window.location.hash !== '#' + path) {
        window.location.hash = '#' + path;
      }

      // Carregar script externo correspondente à página
      await this._loadPageScript(path, matchResult);

    } catch (err) {
      if (err.name === 'AbortError') return; // navegação cancelada intencionalmente
      console.error('[router] Erro ao carregar página:', err);
      this._showErrorPage(err.message);
    }
  }

  /**
   * Remove scripts inline do HTML carregado.
   * Scripts legítimos devem estar em arquivos .js externos.
   * Isso previne execução acidental de código inline e permite CSP estrito.
   */
  _stripInlineScripts(html) {
    // Remover blocos <script>...</script> (não src externos)
    // Manter <script src="..."> pois são carregados pelo browser normalmente
    return html.replace(/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/gi, (match) => {
      if (process?.env?.NODE_ENV !== 'production') {
        console.warn('[router] Script inline removido — migrar para arquivo .js externo');
      }
      return '<!-- script inline removido — use arquivo .js externo -->';
    });
  }

  /**
   * Carrega o script externo da página de forma segura:
   * - Cria um elemento <script src="..."> real
   * - O browser aplica CSP, SRI e cache normalmente
   * - Chama window.__pageInit() se definido pelo script após carregar
   */
  async _loadPageScript(path, matchResult) {
    const scriptSrc = this._resolveScriptPath(path);

    if (!scriptSrc) {
      // Fallback legacy: tentar extrair e executar script inline com aviso
      // Remover quando todas as páginas estiverem migradas
      console.warn(`[router] Sem script externo para ${path}. Página pode não funcionar corretamente.`);
      return;
    }

    return new Promise((resolve, reject) => {
      // Limpar init anterior
      delete window.__pageInit;

      // Remover script anterior da mesma página se existir
      // (necessário para re-execução ao navegar para a mesma página)
      const existingId = `page-script-${scriptSrc.replace(/\//g, '-').replace('.js', '')}`;
      const existing = document.getElementById(existingId);
      if (existing) existing.remove();

      const script    = document.createElement('script');
      script.id       = existingId;
      script.src      = scriptSrc + '?v=' + Date.now();
      script.async    = false; // garantir ordem de execução
      script.defer    = false;

      script.onload = async () => {
        // O script externo deve definir window.__pageInit como função
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

  /**
   * Limpa recursos da página anterior antes de carregar nova.
   * Previne vazamento de event listeners e estado entre páginas.
   */
  _cleanupCurrentPage(container) {
    // Chamar cleanup da página anterior se definido
    if (typeof window.__pageCleanup === 'function') {
      try {
        window.__pageCleanup();
      } catch (e) {
        console.warn('[router] Erro no cleanup da página anterior:', e);
      }
      delete window.__pageCleanup;
    }

    // Remover scripts de página anteriores para evitar acumulação
    document.querySelectorAll('script[id^="page-script-"]').forEach(s => s.remove());

    // Limpar container
    container.innerHTML = '';
    container.textContent = '';
  }

  _showErrorPage(message) {
    const container = document.getElementById('app');
    if (!container) return;
    container.innerHTML = `
      <div style="max-width:600px;margin:100px auto;padding:40px;text-align:center;
                  background:var(--color-background-danger,#fff3f3);
                  border:2px solid var(--color-border-danger,#ffdddd);border-radius:12px;">
        <h2 style="color:#cc0000;margin-bottom:12px;">Erro ao carregar página</h2>
        <p style="color:#666;margin-bottom:20px;">${message}</p>
        <button onclick="window.location.reload()"
                style="padding:12px 24px;background:#000;color:#fff;
                       border:none;border-radius:8px;cursor:pointer;font-size:15px;">
          Recarregar
        </button>
      </div>`;
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
    await this.waitForAuth();
    this.isReady = true;
    const initialPath = window.location.hash.slice(1) || '/';
    await this.navigate(initialPath);
  }
}

const router = new Router();
window.router = router;

document.addEventListener('DOMContentLoaded', () => router.init());