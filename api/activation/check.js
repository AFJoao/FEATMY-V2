/**
 * GET /api/cron/check-subscriptions
 *
 * CORREÇÃO v2 — N+1 no loop de notificações:
 *
 * ANTES:
 *   for (const doc of expiredSnap.docs) {
 *     await db.collection('notifications').add({...}); // ← sequencial, 1 write por iteração
 *   }
 *   // Para 100 assinaturas expirando: 100 writes sequenciais (~5-10s)
 *   // Risco real de timeout (limite da Vercel: 60s para cron jobs)
 *
 * DEPOIS:
 *   Todas as notificações são escritas via batch (ou batch dividido se > 500).
 *   Para 100 assinaturas: 1 batch.commit() ao final de cada seção
 *   Batch do Firestore suporta até 500 operações por commit.
 *
 * TAMBÉM CORRIGIDO:
 *   - Warnings de 7 dias e 3 dias agora usam batch separado
 *   - Atualizações de status (active → grace_period → expired) mantidas em batch
 *   - Commits divididos quando batch ultrapassa 490 operações (margem segura)
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

const db         = admin.firestore();
const GRACE_DAYS = 3;
const BATCH_LIMIT = 490; // margem segura abaixo do limite de 500 do Firestore

/**
 * Commit automático quando batch atinge o limite.
 * Retorna novo batch vazio.
 */
async function flushBatch(batch, count) {
  if (count >= BATCH_LIMIT) {
    await batch.commit();
    return { batch: db.batch(), count: 0 };
  }
  return { batch, count };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Verificar segredo
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const now     = new Date();
  const in7Days = new Date(now); in7Days.setDate(in7Days.getDate() + 7);

  const results = { warnings7d: 0, warnings3d: 0, expired: 0, errors: 0 };

  // ── Assinaturas vencendo em até 7 dias ────────────────────────
  // CORRIGIDO: usar batch em vez de await dentro do loop
  try {
    const soonSnap = await db.collection('subscriptions')
      .where('status', '==', 'active')
      .where('expiresAt', '<=', admin.firestore.Timestamp.fromDate(in7Days))
      .where('expiresAt', '>', admin.firestore.Timestamp.fromDate(now))
      .get();

    if (!soonSnap.empty) {
      let { batch, count } = { batch: db.batch(), count: 0 };

      for (const doc of soonSnap.docs) {
        const sub      = doc.data();
        const expAt    = sub.expiresAt.toDate();
        const daysLeft = Math.ceil((expAt - now) / (1000 * 60 * 60 * 24));
        const urgent   = daysLeft <= 3;

        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
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
        count++;

        urgent ? results.warnings3d++ : results.warnings7d++;

        // Auto-flush se próximo do limite
        const flushed = await flushBatch(batch, count);
        batch = flushed.batch;
        count = flushed.count;
      }

      // Commit do batch restante
      if (count > 0) await batch.commit();
    }
  } catch (e) {
    console.error('[cron] Erro ao processar warnings:', e.message);
    results.errors++;
  }

  // ── Assinaturas expiradas: atualizar status ────────────────────
  // CORRIGIDO: notificações de expiração agora também usam batch
  try {
    const expiredSnap = await db.collection('subscriptions')
      .where('status', 'in', ['active', 'grace_period'])
      .where('expiresAt', '<', admin.firestore.Timestamp.fromDate(now))
      .get();

    if (!expiredSnap.empty) {
      let statusBatch      = db.batch();
      let statusCount      = 0;
      let notifBatch       = db.batch();
      let notifCount       = 0;

      for (const doc of expiredSnap.docs) {
        const sub         = doc.data();
        const expAt       = sub.expiresAt.toDate();
        const graceCutoff = new Date(expAt);
        graceCutoff.setDate(graceCutoff.getDate() + GRACE_DAYS);

        const newStatus = now < graceCutoff ? 'grace_period' : 'expired';
        if (sub.status === newStatus) continue;

        // Atualizar status da subscription
        statusBatch.update(doc.ref, {
          status:    newStatus,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        statusCount++;

        // Atualizar status no doc do personal
        statusBatch.update(db.collection('users').doc(sub.personalId), {
          subscriptionStatus: newStatus,
        });
        statusCount++;

        // Auto-flush do batch de status
        const flushedStatus = await flushBatch(statusBatch, statusCount);
        statusBatch = flushedStatus.batch;
        statusCount = flushedStatus.count;

        // Notificação de expiração total (não para grace_period)
        if (newStatus === 'expired') {
          const notifRef = db.collection('notifications').doc();
          notifBatch.set(notifRef, {
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
          notifCount++;
          results.expired++;

          // Auto-flush do batch de notificações
          const flushedNotif = await flushBatch(notifBatch, notifCount);
          notifBatch = flushedNotif.batch;
          notifCount = flushedNotif.count;
        }
      }

      // Commit dos batches restantes
      if (statusCount > 0) await statusBatch.commit();
      if (notifCount  > 0) await notifBatch.commit();
    }
  } catch (e) {
    console.error('[cron] Erro ao processar expiradas:', e.message);
    results.errors++;
  }

  console.log('[cron] check-subscriptions concluído:', results);
  return res.status(200).json({ success: true, ...results });
};