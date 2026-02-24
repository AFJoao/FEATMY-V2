/**
 * Módulo de Roteamento Otimizado - CORRIGIDO
 * Gerencia navegação entre páginas e proteção de rotas
 */

class Router {
  constructor() {
    this.routes = {
      '/': 'pages/login.html',
      '/login': 'pages/login.html',
      '/signup': 'pages/signup.html',
      '/primeiro-acesso': 'pages/primeiro-acesso.html',
      '/personal/dashboard': 'pages/personal/dashboard.html',
      '/personal/exercises': 'pages/personal/exercises.html',
      '/personal/create-workout': 'pages/personal/create-workout.html',
      '/personal/student/:id': 'pages/personal/student-details.html',
      '/personal/feedbacks': 'pages/personal/feedbacks.html',
      '/student/dashboard': 'pages/student/dashboard.html',
      '/student/view-workout': 'pages/student/view-workout.html',
      '/personal/volume/:id': 'pages/personal/volume-analysis.html'
    };

    this.protectedRoutes = {
      '/personal/dashboard': 'personal',
      '/personal/exercises': 'personal',
      '/personal/create-workout': 'personal',
      '/personal/student/:id': 'personal',
      '/personal/feedbacks': 'personal',
      '/student/dashboard': 'student',
      '/personal/volume/:id': 'personal',
      '/student/view-workout': 'student'
    };

    // Rotas públicas — acessíveis sem login
    // /primeiro-acesso incluído: aluno não tem auth ainda nesse momento
    this.publicRoutes = ['/login', '/signup', '/', '/primeiro-acesso'];

    this.isReady = false;
    this.authReady = false;
    this.currentPath = null;
    this.navigationQueue = [];
    this.isNavigating = false;

    window.addEventListener('hashchange', () => {
      if (this.authReady) {
        this.navigate(window.location.hash.slice(1));
      }
    });

    window.addEventListener('popstate', () => {
      if (this.authReady) {
        this.navigate(window.location.hash.slice(1));
      }
    });
  }

  async waitForAuth() {
    console.log('⏳ Aguardando inicialização do AuthManager...');
    
    return new Promise((resolve) => {
      if (authManager.isInitialized) {
        console.log('✓ AuthManager já inicializado');
        this.authReady = true;
        resolve();
        return;
      }

      const checkInterval = setInterval(() => {
        if (authManager.isInitialized) {
          clearInterval(checkInterval);
          console.log('✓ AuthManager inicializado');
          this.authReady = true;
          resolve();
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        console.warn('⚠️ Timeout aguardando AuthManager - prosseguindo mesmo assim');
        this.authReady = true;
        resolve();
      }, 10000);
    });
  }

  matchRoute(path) {
    if (this.routes[path]) {
      return { route: path, params: {} };
    }

    for (const [route, file] of Object.entries(this.routes)) {
      if (!route.includes(':')) continue;

      const routeParts = route.split('/');
      const pathParts = path.split('/');

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

      if (match) {
        return { route, params };
      }
    }

    return null;
  }

  getRequiredType(path) {
    if (this.protectedRoutes[path]) {
      return this.protectedRoutes[path];
    }

    for (const [route, type] of Object.entries(this.protectedRoutes)) {
      if (!route.includes(':')) continue;

      const routeParts = route.split('/');
      const pathParts = path.split('/');

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

  async navigate(path = '/') {
    if (this.isNavigating && this.currentPath === path) {
      console.log('⏳ Já navegando para:', path);
      return;
    }

    if (this.navigationQueue.length === 0 || this.navigationQueue[this.navigationQueue.length - 1] !== path) {
      this.navigationQueue.push(path);
    }

    if (this.isNavigating) {
      console.log('⏳ Navegação em andamento, adicionando à fila:', path);
      return;
    }

    while (this.navigationQueue.length > 0) {
      const nextPath = this.navigationQueue.shift();
      await this._navigate(nextPath);
    }
  }

  async _navigate(path = '/') {
    this.isNavigating = true;

    try {
      console.log('=== NAVEGANDO PARA:', path, '===');

      if (!path.startsWith('/')) {
        path = '/' + path;
      }

      if (!this.authReady) {
        await this.waitForAuth();
      }

      const requiredType     = this.getRequiredType(path);
      const isAuthenticated  = authManager.isAuthenticated();
      const currentUserType  = authManager.getCurrentUserType();

      console.log('Estado:', { path, requiredType, isAuthenticated, currentUserType });

      // ── Rota protegida ───────────────────────────────────────────
      if (requiredType) {
        if (!isAuthenticated) {
          console.log('❌ Não autenticado, redirecionando para login');
          window.location.hash = '#/login';
          this.isNavigating = false;
          return;
        }

        if (currentUserType !== requiredType) {
          console.log('⚠️ Tipo de usuário incompatível com a rota');
          const redirectPath = currentUserType === 'personal'
            ? '/personal/dashboard'
            : '/student/dashboard';

          if (path !== redirectPath) {
            window.location.hash = '#' + redirectPath;
            this.isNavigating = false;
            return;
          }
        }
      }

      // ── Rota pública com usuário logado ──────────────────────────
      // CORREÇÃO: só redireciona se userType for conhecido (personal ou student).
      // Se userType === null, o usuário pode estar no meio do fluxo de ativação
      // (createUserWithEmailAndPassword disparou onAuthStateChanged antes do doc existir).
      // Nesse caso, deixa a página pública carregar normalmente.
      if (this.publicRoutes.includes(path) && isAuthenticated && currentUserType) {
        console.log('✓ Usuário autenticado com tipo definido, redirecionando para dashboard');
        const redirectPath = currentUserType === 'personal'
          ? '/personal/dashboard'
          : '/student/dashboard';

        if (path !== redirectPath) {
          window.location.hash = '#' + redirectPath;
          this.isNavigating = false;
          return;
        }
      }

      // ── Carregar página ──────────────────────────────────────────
      if (this.currentPath !== path) {
        await this.loadPage(path);
        this.currentPath = path;
      }
    } catch (error) {
      console.error('Erro durante navegação:', error);
    } finally {
      this.isNavigating = false;
    }
  }

  async loadPage(path) {
    const matchResult = this.matchRoute(path);
    
    if (!matchResult) {
      console.log('❌ Rota não encontrada:', path);
      this.loadPage('/login');
      return;
    }

    const pagePath = this.routes[matchResult.route];
    window.routeParams = matchResult.params;

    try {
      console.log('Carregando página:', pagePath);
      const cacheBuster = '?v=' + Date.now();
      const response = await fetch(pagePath + cacheBuster);
      
      if (!response.ok) {
        throw new Error('Página não encontrada');
      }

      const html = await response.text();
      const container = document.getElementById('app');
      
      if (!container) {
        console.error('❌ Container #app não encontrado');
        return;
      }

      container.innerHTML = '';
      container.textContent = '';
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      container.innerHTML = html;
      console.log('✓ HTML carregado');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const scripts = container.querySelectorAll('script');
      console.log('Scripts encontrados:', scripts.length);
      
      for (const script of scripts) {
        try {
          const scriptFunction = new Function(script.textContent);
          scriptFunction();
          console.log('✓ Script executado');
          await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
          console.error('Erro ao executar script:', error);
        }
      }

      if (window.location.hash !== '#' + path) {
        window.location.hash = '#' + path;
      }

      console.log('✓ Página totalmente carregada');
    } catch (error) {
      console.error('❌ Erro ao carregar página:', error);
      const container = document.getElementById('app');
      if (container) {
        container.innerHTML = `
          <div style="max-width: 600px; margin: 100px auto; padding: 40px; text-align: center; background: #fff3f3; border: 2px solid #ffdddd; border-radius: 12px;">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cc0000" stroke-width="2" style="margin: 0 auto 20px; display: block;">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <h2 style="color: #cc0000; margin-bottom: 12px;">Erro ao carregar página</h2>
            <p style="color: #666; margin-bottom: 20px;">${error.message}</p>
            <button onclick="window.location.reload()" style="padding: 12px 24px; background: #000000; color: #ffffff; border: none; border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: 600;">Recarregar</button>
          </div>
        `;
      }
    }
  }

  goToLogin()             { this.navigate('/login'); }
  goToSignup()            { this.navigate('/signup'); }
  goToPersonalDashboard() { this.navigate('/personal/dashboard'); }
  goToStudentDashboard()  { this.navigate('/student/dashboard'); }
  goToCreateWorkout()     { this.navigate('/personal/create-workout'); }
  goToExercises()         { this.navigate('/personal/exercises'); }
  goToViewWorkout()       { this.navigate('/student/view-workout'); }
  goToStudentDetails(studentId) { this.navigate(`/personal/student/${studentId}`); }
  goTo(path)              { this.navigate(path); }
  goToVolumeAnalysis(studentId) { this.navigate(`/personal/volume/${studentId}`); }

  async init() {
    console.log('=== INICIALIZANDO ROUTER ===');
    await this.waitForAuth();
    this.isReady = true;
    const initialPath = window.location.hash.slice(1) || '/';
    console.log('Caminho inicial:', initialPath);
    await this.navigate(initialPath);
  }
}

const router = new Router();
window.router = router;

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM pronto, inicializando router...');
  router.init();
});