/**
 * POST /api/activation/activate — v2
 *
 * CORREÇÕES v2:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Rate limiting distribuído via Upstash Redis (funciona em múltiplas instâncias
 *    serverless — o rate limiting in-memory anterior não era eficaz)
 *
 * 2. Fallback in-memory para dev (sem Redis configurado)
 *
 * 3. Token limpo da memória após uso (não fica em variáveis globais)
 *
 * 4. Validação mais robusta de inputs antes de qualquer acesso ao Firestore
 * ─────────────────────────────────────────────────────────────────────────────
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

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Tenta usar Upstash Redis; cai para in-memory em dev
let Ratelimit, Redis;
try {
  ({ Ratelimit } = require('@upstash/ratelimit'));
  ({ Redis }     = require('@upstash/redis'));
} catch { /* pacotes não instalados */ }

let _rl = null;
function getRateLimiter() {
  if (_rl) return _rl;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !Ratelimit || !Redis) return null;
  const redis = new Redis({ url, token });
  _rl = new Ratelimit({
    redis,
    limiter:   Ratelimit.slidingWindow(5, '60 s'), // 5 ativações/min por IP
    analytics: false,
    prefix:    'featym_rl_activate',
  });
  return _rl;
}

// Fallback in-memory para dev
const memHits = new Map();
function isMemRateLimited(ip) {
  const now = Date.now();
  const hits = (memHits.get(ip) || []).filter(t => now - t < 60_000);
  if (hits.length >= 5) return true;
  hits.push(now);
  memHits.set(ip, hits);
  return false;
}

async function checkRateLimit(ip) {
  const rl = getRateLimiter();
  if (rl) {
    try {
      const { success } = await rl.limit(`activate:ip:${ip}`);
      return !success;
    } catch (err) {
      if (process.env.NODE_ENV === 'production') throw err;
      console.warn('[activate] Redis unavailable, using memory fallback:', err.message);
    }
  }
  return isMemRateLimited(ip);
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).end();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // Rate limiting
  try {
    const limited = await checkRateLimit(ip);
    if (limited) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
    }
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[activate] Rate limit error em produção:', err.message);
      return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }
  }

  const { token, password, email } = req.body || {};

  // ── Validação de inputs ────────────────────────────────────────────────────
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Token inválido.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: 'Senha muito longa.' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const emailKey        = normalizedEmail.replace(/[^a-z0-9]/g, '_');
  const lockRef         = db.collection('activationLocks').doc(emailKey);
  const activationRef   = db.collection('pendingActivations').doc(emailKey);

  let studentData;
  let activationData;

  try {
    // ── Lock atômico via Firestore Transaction ─────────────────────────────
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
        // Lock expirado — continuar (será sobrescrito abaixo)
      }

      if (!activationDoc.exists) throw new Error('TOKEN_NOT_FOUND');

      activationData = activationDoc.data();

      if (activationData.activationToken !== token) throw new Error('TOKEN_INVALID');
      if (activationData.status !== 'pending')       throw new Error('TOKEN_USED');

      const expiresAt = activationData.expiresAt?.toDate() || new Date(0);
      if (new Date() > expiresAt) throw new Error('TOKEN_EXPIRED');

      // Adquirir lock + marcar token como em-uso (atômico)
      t.set(lockRef, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        email:     normalizedEmail,
        ip,
      });
      t.update(activationRef, { status: 'activating' });
    });

    // ── Buscar dados do aluno (fora da transação) ──────────────────────────
    const studentDoc = await db.collection('users').doc(activationData.studentDocId).get();
    if (!studentDoc.exists) throw new Error('STUDENT_NOT_FOUND');
    studentData = studentDoc.data();

    // ── Criar usuário no Firebase Auth ─────────────────────────────────────
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email:       normalizedEmail,
        password,
        displayName: studentData.name,
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        userRecord = await admin.auth().getUserByEmail(normalizedEmail);
        // Verificar se conta já ativa
        const existingDoc = await db.collection('users').doc(userRecord.uid).get();
        if (existingDoc.exists && existingDoc.data().status === 'active') {
          await lockRef.delete();
          const customToken = await admin.auth().createCustomToken(userRecord.uid);
          return res.status(200).json({ success: true, customToken });
        }
      } else {
        // Reverter lock e status
        await Promise.allSettled([
          lockRef.delete(),
          activationRef.update({ status: 'pending' }),
        ]);
        throw authError;
      }
    }

    // ── Batch final — finalizar ativação atomicamente ──────────────────────
    const batch = db.batch();

    // Criar doc do aluno com uid real
    batch.set(db.collection('users').doc(userRecord.uid), {
      ...studentData,
      uid:         userRecord.uid,
      authUid:     userRecord.uid,
      status:      'active',
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
      status:    'used',
      usedAt:    admin.firestore.FieldValue.serverTimestamp(),
      usedByUid: userRecord.uid,
    });

    // Liberar lock
    batch.delete(lockRef);

    await batch.commit();

    // Adicionar novo uid ao array de alunos (fora do batch por limitação do Firestore)
    if (studentData.personalId && activationData.studentDocId !== userRecord.uid) {
      await db.collection('users').doc(studentData.personalId).update({
        students: admin.firestore.FieldValue.arrayUnion(userRecord.uid),
      });
    }

    // Gerar custom token para login automático
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    console.log(`[activate] ✓ Conta ativada: ${normalizedEmail} uid=${userRecord.uid}`);
    return res.status(200).json({ success: true, customToken });

  } catch (error) {
    // Limpar lock em caso de erro inesperado
    const knownErrors = [
      'TOKEN_NOT_FOUND', 'TOKEN_INVALID', 'TOKEN_USED',
      'TOKEN_EXPIRED', 'CONCURRENT_ACTIVATION', 'STUDENT_NOT_FOUND',
    ];
    if (!knownErrors.includes(error.message)) {
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
    console.error('[activate] Erro:', error.message, error.code || '');
    return res.status(status).json({ error: message });
  }
};