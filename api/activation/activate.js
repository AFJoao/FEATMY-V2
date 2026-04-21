/**
 * POST /api/activation/activate — v3
 *
 * CORREÇÃO 3.4  — validateContentType adicionado.
 * CORREÇÃO 3.10 — Firebase Admin via _lib/firebase-admin.js centralizado.
 *
 * Todas as correções v2 mantidas (rate limiting distribuído, lock atômico, etc.)
 */

const { validateContentType } = require('../_lib/validateContentType');
const { admin, db }           = require('../_lib/firebase-admin');

// ── Rate limiting ─────────────────────────────────────────────────────────
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
    limiter:   Ratelimit.slidingWindow(5, '60 s'),
    analytics: false,
    prefix:    'featym_rl_activate',
  });
  return _rl;
}

const memHits = new Map();
function isMemRateLimited(ip) {
  const now  = Date.now();
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

// ── Handler ───────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).end();

  // ── CORREÇÃO 3.4: Content-Type validation ─────────────────────────────────
  if (!validateContentType(req, res)) return;

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // ── Rate limiting ─────────────────────────────────────────────────────────
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

  // NOTA: emailKey agora é gerado server-side via SHA-256 (alinhado com js/auth.js v8)
  // O servidor recebe o token e busca por ele diretamente na collection,
  // não precisa recalcular o emailKey para encontrar o documento.
  const lockRef       = db.collection('activationLocks').doc(
    // Usar hash do token como chave do lock (único e seguro)
    require('crypto').createHash('sha256').update(token).digest('hex').slice(0, 32)
  );
  const activationRef = await (async () => {
    // Buscar documento de ativação pelo token (índice composto garante eficiência)
    const snap = await db.collection('pendingActivations')
      .where('activationToken', '==', token)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].ref;
  })();

  if (!activationRef) {
    return res.status(404).json({ error: 'Link de ativação inválido.' });
  }

  let studentData;
  let activationData;

  try {
    // ── Lock atômico via Firestore Transaction ─────────────────────────────
    await db.runTransaction(async (t) => {
      const [lockDoc, activationDoc] = await Promise.all([
        t.get(lockRef),
        t.get(activationRef),
      ]);

      if (lockDoc.exists) {
        const lockTime       = lockDoc.data().createdAt?.toDate() || new Date(0);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (lockTime > fiveMinutesAgo) {
          throw new Error('CONCURRENT_ACTIVATION');
        }
      }

      if (!activationDoc.exists) throw new Error('TOKEN_NOT_FOUND');

      activationData = activationDoc.data();

      if (activationData.activationToken !== token) throw new Error('TOKEN_INVALID');
      if (activationData.status !== 'pending')       throw new Error('TOKEN_USED');

      const expiresAt = activationData.expiresAt?.toDate() || new Date(0);
      if (new Date() > expiresAt) throw new Error('TOKEN_EXPIRED');

      t.set(lockRef, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        email:     normalizedEmail,
        ip,
      });
      t.update(activationRef, { status: 'activating' });
    });

    // ── Buscar dados do aluno ──────────────────────────────────────────────
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
        const existingDoc = await db.collection('users').doc(userRecord.uid).get();
        if (existingDoc.exists && existingDoc.data().status === 'active') {
          await lockRef.delete();
          const customToken = await admin.auth().createCustomToken(userRecord.uid);
          return res.status(200).json({ success: true, customToken });
        }
      } else {
        await Promise.allSettled([
          lockRef.delete(),
          activationRef.update({ status: 'pending' }),
        ]);
        throw authError;
      }
    }

    // ── Batch final ────────────────────────────────────────────────────────
    const batch = db.batch();

    batch.set(db.collection('users').doc(userRecord.uid), {
      ...studentData,
      uid:         userRecord.uid,
      authUid:     userRecord.uid,
      status:      'active',
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (activationData.studentDocId !== userRecord.uid) {
      batch.delete(db.collection('users').doc(activationData.studentDocId));
    }

    if (studentData.personalId && activationData.studentDocId !== userRecord.uid) {
      batch.update(db.collection('users').doc(studentData.personalId), {
        students: admin.firestore.FieldValue.arrayRemove(activationData.studentDocId),
      });
    }

    batch.update(activationRef, {
      status:    'used',
      usedAt:    admin.firestore.FieldValue.serverTimestamp(),
      usedByUid: userRecord.uid,
    });

    batch.delete(lockRef);

    await batch.commit();

    if (studentData.personalId && activationData.studentDocId !== userRecord.uid) {
      await db.collection('users').doc(studentData.personalId).update({
        students: admin.firestore.FieldValue.arrayUnion(userRecord.uid),
      });
    }

    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    console.log(`[activate] ✓ Conta ativada: ${normalizedEmail} uid=${userRecord.uid}`);
    return res.status(200).json({ success: true, customToken });

  } catch (error) {
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