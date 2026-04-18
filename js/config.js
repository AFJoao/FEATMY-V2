/**
 * js/config.js — v2
 *
 * CORREÇÃO v2 (VULN 4 — Firebase App Check):
 *
 * Sem App Check, qualquer pessoa com as credenciais Firebase (públicas no JS)
 * pode usar o SDK diretamente para abusar de Auth, Firestore e funções sem
 * passar pela camada serverless — contornando rate limiting, CORS e validações.
 *
 * App Check com reCAPTCHA v3 garante que apenas código rodando em domínios
 * autorizados pode chamar Firebase APIs. Requisições sem token válido são
 * bloqueadas pelo Firebase antes de atingir Firestore ou Auth.
 *
 * SETUP NECESSÁRIO (Firebase Console):
 * 1. Firebase Console > App Check > Registrar app
 * 2. Escolher reCAPTCHA v3 como provedor
 * 3. Obter site key (não a secret key) e substituir ABAIXO
 * 4. Após deploy e testes: App Check > Enforce para Firestore e Authentication
 *    (ATENÇÃO: enforce bloqueia chamadas sem token — testar em debug mode primeiro)
 *
 * DEBUG em desenvolvimento:
 *   No console do navegador antes de carregar a página:
 *   self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
 *   O Firebase imprimirá um token de debug para adicionar no Console.
 */

const firebaseConfig = {
  apiKey: "AIzaSyDl0LKspEod8C_ZsvamibDdne7YiXgos-E",
  authDomain: "featmy-c6e7e.firebaseapp.com",
  projectId: "featmy-c6e7e",
  storageBucket: "featmy-c6e7e.firebasestorage.app",
  messagingSenderId: "79916128482",
  appId: "1:79916128482:web:3f31fec268ff0073e526bb",
  measurementId: "G-S24EG1KQ56"
};

// Inicializar Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// ── Firebase App Check (VULN 4) ──────────────────────────────────────────────
// Bloqueia uso direto do SDK Firebase sem token App Check válido.
// Sem App Check, qualquer pessoa pode usar as credenciais acima para acessar
// Firestore e Auth diretamente, sem passar pelas serverless functions.
//
// INSTRUÇÃO: Substituir 'SUBSTITUA_PELA_SUA_RECAPTCHA_V3_SITE_KEY' pela
// site key obtida em: Firebase Console > App Check > Apps > reCAPTCHA v3
(function initAppCheck() {
  const RECAPTCHA_SITE_KEY = '6LdTGL0sAAAAAGyw5Sm8-OoEpxAFEeIAoeyr6gt4';

  // Não inicializar se a chave ainda não foi configurada
  if (!RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY.startsWith('SUBSTITUA')) {
    console.warn(
      '[config] Firebase App Check NÃO inicializado — configure RECAPTCHA_SITE_KEY em js/config.js. ' +
      'Sem App Check, as credenciais Firebase são acessíveis publicamente.'
    );
    return;
  }

  try {
    if (typeof firebase.appCheck !== 'function') {
      console.warn('[config] App Check SDK não carregado — adicione o script em index.html antes de config.js');
      return;
    }

    const appCheck = firebase.appCheck();
    appCheck.activate(
      new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      true // isTokenAutoRefreshEnabled — mantém token válido automaticamente
    );

    console.info('[config] Firebase App Check inicializado com reCAPTCHA v3');
  } catch (err) {
    console.error('[config] Erro ao inicializar App Check:', err.message);
  }
})();

// Referências globais para Auth e Firestore
const auth = firebase.auth();
const db = firebase.firestore();

// Configurar persistência de autenticação
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(error => console.error('Erro ao configurar persistência:', error));

// Exportar para uso global
window.firebaseConfig = firebaseConfig;
window.auth = auth;
window.db = db;
window.firebase = firebase;