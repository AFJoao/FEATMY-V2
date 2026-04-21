/**
 * GET /api/cron/check-subscriptions
 *
 * CORREÇÃO 3.6 — Proteção contra execução dupla via Firestore lock.
 * Vercel pode executar duas instâncias do cron simultaneamente.
 * Um documento de lock garante que apenas uma instância processa por vez.
 */

const { admin, db } = require('../_lib/firebase-admin');

const GRACE_DAYS    = 3;
const LOCK_TIMEOUT  = 5 * 60 * 1000; // 5 minutos

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  // ── CORREÇÃO 3.6: Lock distribuído via Firestore ──────────────────────────
  const lockRef = db.collection('cronLocks').doc('check-subscriptions');

  try {
    await db.runTransaction(async (t) => {
      const lock = await t.get(lockRef);

      if (lock.exists) {
        const runningAt = lock.data().runningAt?.toMillis?.() || 0;
        const ageMs     = Date.now() - runningAt;

        if (ageMs < LOCK_TIMEOUT) {
          throw new Error('ALREADY_RUNNING');
        }
        // Lock expirado — sobrescrever
      }

      t.set(lockRef, {
        runningAt: admin.firestore.FieldValue.serverTimestamp(),
        startedAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    if (err.message === 'ALREADY_RUNNING') {
      console.log('[cron] Execução ignorada — outra instância já está rodando');
      return res.status(200).json({ skipped: true, reason: 'already_running' });
    }
    console.error('[cron] Erro ao adquirir lock:', err.message);
    return res.status(500).json({ error: 'Erro ao iniciar cron' });
  }

  const now     = new Date();
  const in7Days = new Date(now); in7Days.setDate(in7Days.getDate() + 7);

  const results = { warnings7d: 0, warnings3d: 0, expired: 0, errors: 0 };

  try {
    // ── Assinaturas vencendo em até 7 dias ──────────────────────────────────
    try {
      const soonSnap = await db.collection('subscriptions')
        .where('status', '==', 'active')
        .where('expiresAt', '<=', admin.firestore.Timestamp.fromDate(in7Days))
        .where('expiresAt', '>', admin.firestore.Timestamp.fromDate(now))
        .get();

      for (const doc of soonSnap.docs) {
        const sub      = doc.data();
        const expAt    = sub.expiresAt.toDate();
        const daysLeft = Math.ceil((expAt - now) / (1000 * 60 * 60 * 24));
        const urgent   = daysLeft <= 3;

        try {
          await db.collection('notifications').add({
            userId:      sub.personalId,
            type:        'subscription_warning',
            level:       urgent ? 'warning' : 'info',
            title:       urgent ? '⚠️ Assinatura vence em breve!' : '📅 Lembrete de renovação',
            message:     `Sua assinatura vence em ${daysLeft} dia(s). Renove para manter o acesso dos alunos.`,
            actionUrl:   '/#/personal/billing',
            actionLabel: 'Renovar agora',
            read:        false,
            createdAt:   admin.firestore.FieldValue.serverTimestamp(),
          });
          urgent ? results.warnings3d++ : results.warnings7d++;
        } catch (e) {
          console.error('[cron] Erro ao criar notificação:', e.message);
          results.errors++;
        }
      }
    } catch (e) {
      console.error('[cron] Erro ao buscar assinaturas vencendo:', e.message);
      results.errors++;
    }

    // ── Assinaturas expiradas: atualizar status ─────────────────────────────
    try {
      const expiredSnap = await db.collection('subscriptions')
        .where('status', 'in', ['active', 'grace_period'])
        .where('expiresAt', '<', admin.firestore.Timestamp.fromDate(now))
        .get();

      const batch = db.batch();
      let batchCount = 0;

      for (const doc of expiredSnap.docs) {
        const sub          = doc.data();
        const expAt        = sub.expiresAt.toDate();
        const graceCutoff  = new Date(expAt);
        graceCutoff.setDate(graceCutoff.getDate() + GRACE_DAYS);

        const newStatus = now < graceCutoff ? 'grace_period' : 'expired';
        if (sub.status === newStatus) continue;

        batch.update(doc.ref, {
          status:    newStatus,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        batch.update(db.collection('users').doc(sub.personalId), {
          subscriptionStatus: newStatus,
        });
        batchCount++;

        if (newStatus === 'expired') {
          await db.collection('notifications').add({
            userId:      sub.personalId,
            type:        'subscription_expired',
            level:       'danger',
            title:       '🔒 Assinatura expirada',
            message:     'Sua assinatura expirou. Os alunos não conseguem mais acessar os treinos. Renove agora.',
            actionUrl:   '/#/personal/billing',
            actionLabel: 'Renovar agora',
            read:        false,
            createdAt:   admin.firestore.FieldValue.serverTimestamp(),
          });
          results.expired++;
        }
      }

      if (batchCount > 0) await batch.commit();
    } catch (e) {
      console.error('[cron] Erro ao processar expiradas:', e.message);
      results.errors++;
    }

  } finally {
    // Sempre liberar o lock ao terminar
    await lockRef.delete().catch(e => console.error('[cron] Erro ao liberar lock:', e.message));
  }

  console.log('[cron] check-subscriptions concluído:', results);
  return res.status(200).json({ success: true, ...results });
};