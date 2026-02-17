/**
 * Configuração do Firebase
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