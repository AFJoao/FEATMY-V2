/**
 * api/_lib/firebase-admin.js
 *
 * CORREÇÃO 3.10 — Firebase Admin centralizado.
 * Antes: cada endpoint inicializava o Admin com padrões diferentes,
 * criando risco de configuração inconsistente.
 * Agora: singleton único, fail-fast se variáveis não configuradas.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      'Variáveis de ambiente do Firebase não configuradas: ' +
      [
        !FIREBASE_PROJECT_ID   && 'FIREBASE_PROJECT_ID',
        !FIREBASE_CLIENT_EMAIL && 'FIREBASE_CLIENT_EMAIL',
        !FIREBASE_PRIVATE_KEY  && 'FIREBASE_PRIVATE_KEY',
      ].filter(Boolean).join(', ')
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

module.exports = { admin, db: admin.firestore() };