/**
 * POST /api/activation/activate
 *
 * Ativação de conta de aluno com:
 * - Lock atômico via Firestore Transaction (previne race condition entre dispositivos)
 * - Validação completa do token server-side
 * - Idempotência: auth/email-already-exists tratado de forma segura
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// Rate limiting simples em memória para este endpoint
// (Upstash é melhor para produção, mas este é um fallback funcional)
const recentRequests = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const key = `activate:${ip}`;
  const last = recentRequests.get(key) || [];
  const recent = last.filter(t => now - t < 60_000);
  if (recent.length >= 5) return true;
  recent.push(now);
  recentRequests.set(key, recent);
  // Limpar entradas antigas periodicamente
  if (recentRequests.size > 10000) {
    for (const [k, v] of recentRequests) {
      if (v.every(t => now - t > 60_000)) recentRequests.delete(k);
    }
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).end();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
  }

  const { token, password, email } = req.body || {};

  // Validação básica de inputs
  if (!token || typeof token !== 'string' || token.length < 32) {
    return res.status(400).json({ error: 'Token inválido.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const emailKey = normalizedEmail.replace(/[^a-z0-9]/g, '_');
  const lockRef = db.collection('activationLocks').doc(emailKey);
  const activationRef = db.collection('pendingActivations').doc(emailKey);

  let studentData;
  let activationData;

  try {
    // LOCK ATÔMICO: verificar e adquirir em uma única transação
    await db.runTransaction(async (t) => {
      const [lockDoc, activationDoc] = await Promise.all([
        t.get(lockRef),
        t.get(activationRef),
      ]);

      // Verificar lock existente (válido por 5 minutos)
      if (lockDoc.exists) {
        const lockTime = lockDoc.data().createdAt?.toDate() || new Date(0);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (lockTime > fiveMinutesAgo) {
          throw new Error('CONCURRENT_ACTIVATION');
        }
      }

      if (!activationDoc.exists) {
        throw new Error('TOKEN_NOT_FOUND');
      }

      activationData = activationDoc.data();

      if (activationData.activationToken !== token) {
        throw new Error('TOKEN_INVALID');
      }

      if (activationData.status !== 'pending') {
        throw new Error('TOKEN_USED');
      }

      const expiresAt = activationData.expiresAt?.toDate() || new Date(0);
      if (new Date() > expiresAt) {
        throw new Error('TOKEN_EXPIRED');
      }

      // Adquirir lock + marcar token como em-uso atomicamente
      t.set(lockRef, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        email: normalizedEmail,
      });
      t.update(activationRef, { status: 'activating' });
    });

    // Buscar dados do aluno (fora da transação para evitar reads excessivos)
    const studentDoc = await db.collection('users').doc(activationData.studentDocId).get();
    if (!studentDoc.exists) throw new Error('STUDENT_NOT_FOUND');
    studentData = studentDoc.data();

    // Criar usuário no Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: normalizedEmail,
        password,
        displayName: studentData.name,
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        // Usuário Auth já existe — verificar se é o aluno correto
        userRecord = await admin.auth().getUserByEmail(normalizedEmail);
        // Verificar se este uid já tem um doc de usuário ativo
        const existingUserDoc = await db.collection('users').doc(userRecord.uid).get();
        if (existingUserDoc.exists && existingUserDoc.data().status === 'active') {
          // Conta já ativa — limpar lock e retornar sucesso
          await lockRef.delete();
          const customToken = await admin.auth().createCustomToken(userRecord.uid);
          return res.status(200).json({ success: true, customToken });
        }
      } else {
        // Reverter: liberar lock e restaurar status do token
        await Promise.allSettled([
          lockRef.delete(),
          activationRef.update({ status: 'pending' }),
        ]);
        throw authError;
      }
    }

    // Batch para finalizar ativação atomicamente
    const batch = db.batch();

    // Criar doc do aluno com uid real
    batch.set(db.collection('users').doc(userRecord.uid), {
      ...studentData,
      uid: userRecord.uid,
      authUid: userRecord.uid,
      status: 'active',
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Remover doc provisório (se diferente do uid real)
    if (activationData.studentDocId !== userRecord.uid) {
      batch.delete(db.collection('users').doc(activationData.studentDocId));
    }

    // Atualizar array de alunos do personal (remover id provisório)
    if (studentData.personalId && activationData.studentDocId !== userRecord.uid) {
      batch.update(db.collection('users').doc(studentData.personalId), {
        students: admin.firestore.FieldValue.arrayRemove(activationData.studentDocId),
      });
    }

    // Marcar token como usado
    batch.update(activationRef, {
      status: 'used',
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      usedByUid: userRecord.uid,
    });

    // Liberar lock
    batch.delete(lockRef);

    await batch.commit();

    // Adicionar novo uid ao array de alunos (fora do batch — arrayUnion após arrayRemove)
    if (studentData.personalId && activationData.studentDocId !== userRecord.uid) {
      await db.collection('users').doc(studentData.personalId).update({
        students: admin.firestore.FieldValue.arrayUnion(userRecord.uid),
      });
    }

    const customToken = await admin.auth().createCustomToken(userRecord.uid);
    return res.status(200).json({ success: true, customToken });

  } catch (error) {
    // Limpar lock em caso de erro inesperado
    if (!['TOKEN_NOT_FOUND', 'TOKEN_INVALID', 'TOKEN_USED', 'TOKEN_EXPIRED', 'CONCURRENT_ACTIVATION'].includes(error.message)) {
      await Promise.allSettled([lockRef.delete()]);
    }

    const errorMap = {
      'CONCURRENT_ACTIVATION': [409, 'Ativação já em andamento em outro dispositivo. Aguarde alguns minutos.'],
      'TOKEN_NOT_FOUND':       [404, 'Link de ativação inválido.'],
      'TOKEN_INVALID':         [401, 'Token inválido.'],
      'TOKEN_USED':            [410, 'Este link já foi utilizado. Faça login normalmente.'],
      'TOKEN_EXPIRED':         [410, 'Link expirado. Solicite novo ao seu personal trainer.'],
      'STUDENT_NOT_FOUND':     [404, 'Dados não encontrados. Contate seu personal trainer.'],
    };

    const [status, message] = errorMap[error.message] || [500, 'Erro interno. Tente novamente.'];
    console.error('[activation/activate] Erro:', error.message, error.code || '');
    return res.status(status).json({ error: message });
  }
};