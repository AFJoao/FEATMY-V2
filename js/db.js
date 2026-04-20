/**
 * js/db.js — v6
 *
 * CORREÇÕES v6:
 *
 * createFeedback — desnormaliza personalId:
 *   Adiciona campo `personalId` no documento de feedback, eliminando a necessidade
 *   de chunk queries via workoutId para listar feedbacks do personal.
 *   Permite query direta: feedbacks.where('personalId', '==', uid).
 *
 * deleteWorkout — usa batch para consistência:
 *   Antes: duas operações separadas (update + delete) → possível inconsistência.
 *   Agora: batch atômico garante que assignedWorkouts e workout são atualizados juntos.
 *
 * getPersonalFeedbacks — estratégia dupla:
 *   Tenta primeiro query por personalId (índice simples, sem chunks).
 *   Fallback para chunk query por workoutId caso índice ainda não exista.
 *
 * Todas as correções v5 mantidas.
 */

class DatabaseManager {

  // ── YouTube URL converter ─────────────────────────────────────────
  convertYouTubeUrl(url) {
    if (!url || url.trim() === '') return '';
    if (url.includes('/embed/')) return url;

    let videoId = null;
    const watchMatch = url.match(/[?&]v=([^&]+)/);
    if (watchMatch) videoId = watchMatch[1];

    const shortMatch = url.match(/youtu\.be\/([^?]+)/);
    if (shortMatch) videoId = shortMatch[1];

    const embedMatch = url.match(/\/embed\/([^?]+)/);
    if (embedMatch) videoId = embedMatch[1];

    if (videoId) {
      videoId = videoId.split('&')[0].split('?')[0];
      return `https://www.youtube.com/embed/${videoId}`;
    }
    return url;
  }

  // ── Users ─────────────────────────────────────────────────────────

  async getCurrentUserData() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) return null;
      const userDoc = await db.collection('users').doc(user.uid).get();
      return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
    } catch (error) {
      console.error('[db] Erro ao obter dados do usuário:', error);
      return null;
    }
  }

  async getUserData(uid) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
    } catch (error) {
      console.error('[db] Erro ao obter dados do usuário:', error);
      return null;
    }
  }

  async getStudentById(studentId) {
    return await this.getUserData(studentId);
  }

  async getMyStudents({ limit = 100, startAfter = null } = {}) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) return [];

      let query = db.collection('users')
        .where('personalId', '==', user.uid)
        .where('userType', '==', 'student')
        .limit(limit);

      if (startAfter) query = query.startAfter(startAfter);

      const snapshot = await query.get();
      return snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('[db] Erro ao buscar alunos:', error);
      return [];
    }
  }

  async getAllStudents() {
    return await this.getMyStudents();
  }

  // ── Exercises ─────────────────────────────────────────────────────

  async createExercise(nameOrObj, description, videoUrl) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      let name, desc, vUrl, muscleGroup, muscles;

      if (typeof nameOrObj === 'object') {
        name        = nameOrObj.name;
        desc        = nameOrObj.description || '';
        vUrl        = nameOrObj.videoUrl || '';
        muscleGroup = nameOrObj.muscleGroup || '';
        muscles     = nameOrObj.muscles || [];
      } else {
        name        = nameOrObj;
        desc        = description || '';
        vUrl        = videoUrl || '';
        muscleGroup = '';
        muscles     = [];
      }

      const embedUrl    = this.convertYouTubeUrl(vUrl);
      const exerciseRef = db.collection('exercises').doc();

      await exerciseRef.set({
        id:          exerciseRef.id,
        name:        name || '',
        description: desc || '',
        muscleGroup: muscleGroup || '',
        muscles:     muscles,
        videoUrl:    embedUrl || '',
        personalId:  user.uid,
        createdBy:   user.uid,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, id: exerciseRef.id };
    } catch (error) {
      console.error('[db] Erro ao criar exercício:', error);
      return { success: false, error: error.message };
    }
  }

  async addExercise(data) {
    return await this.createExercise(data);
  }

  async getPersonalExercises() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      let docs = [];

      try {
        const snap = await db.collection('exercises')
          .where('personalId', '==', user.uid)
          .orderBy('createdAt', 'desc')
          .limit(200)
          .get();
        docs = snap.docs;
      } catch (indexErr) {
        if (indexErr.code === 'failed-precondition' || (indexErr.message || '').includes('index')) {
          console.warn('[db] Índice de exercícios ausente, usando fallback sem orderBy.');
          const snap = await db.collection('exercises')
            .where('personalId', '==', user.uid)
            .limit(200)
            .get();
          docs = snap.docs;
        } else {
          throw indexErr;
        }
      }

      const seen      = new Set();
      const exercises = [];

      docs.forEach(doc => {
        if (!seen.has(doc.id)) {
          seen.add(doc.id);
          exercises.push(doc.data());
        }
      });

      exercises.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        const aSeconds = a.createdAt.seconds || 0;
        const bSeconds = b.createdAt.seconds || 0;
        return bSeconds - aSeconds;
      });

      return exercises;
    } catch (error) {
      console.error('[db] Erro ao obter exercícios:', error);
      return [];
    }
  }

  async getExercises() {
    return await this.getPersonalExercises();
  }

  async getExercise(exerciseId) {
    try {
      const doc = await db.collection('exercises').doc(exerciseId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('[db] Erro ao obter exercício:', error);
      return null;
    }
  }

  async deleteExercise(exerciseId) {
    try {
      await db.collection('exercises').doc(exerciseId).delete();
      return { success: true };
    } catch (error) {
      console.error('[db] Erro ao deletar exercício:', error);
      return { success: false, error: error.message };
    }
  }

  // ── Workouts ──────────────────────────────────────────────────────

  async createWorkout(nameOrObj, description, days, studentId) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      let name, desc, daysData, stdId;

      if (typeof nameOrObj === 'object') {
        name     = nameOrObj.name || '';
        desc     = nameOrObj.description || '';
        daysData = nameOrObj.days || {};
        stdId    = nameOrObj.studentId || null;
      } else {
        name     = nameOrObj || '';
        desc     = description || '';
        daysData = days || {};
        stdId    = studentId || null;
      }

      const workoutRef = db.collection('workouts').doc();

      await workoutRef.set({
        id:          workoutRef.id,
        name,
        description: desc,
        personalId:  user.uid,
        days:        daysData,
        studentId:   stdId || '',
        createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
      });

      if (stdId) {
        try {
          await db.collection('users').doc(stdId).update({
            assignedWorkouts: firebase.firestore.FieldValue.arrayUnion(workoutRef.id),
          });
        } catch (e) { /* não crítico */ }
      }

      return { success: true, id: workoutRef.id };
    } catch (error) {
      console.error('[db] Erro ao criar treino:', error);
      return { success: false, error: error.message };
    }
  }

  async getPersonalWorkouts({ limit = 100, startAfter = null } = {}) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      let query = db.collection('workouts')
        .where('personalId', '==', user.uid)
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (startAfter) query = query.startAfter(startAfter);

      const snapshot = await query.get();
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error('[db] Erro ao obter treinos do personal:', error);
      return [];
    }
  }

  _sortWorkoutsByDate(workouts) {
    return workouts.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.seconds - a.createdAt.seconds;
    });
  }

  async getStudentWorkouts(studentIdParam) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const targetId = studentIdParam || user.uid;

      const userDoc          = await db.collection('users').doc(targetId).get();
      const assignedWorkouts = userDoc.exists ? (userDoc.data().assignedWorkouts || []) : [];

      if (assignedWorkouts.length > 0) {
        const workoutPromises = assignedWorkouts.slice(0, 50).map(id =>
          db.collection('workouts').doc(id).get()
            .then(doc => doc.exists ? { id: doc.id, ...doc.data() } : null)
            .catch(() => null)
        );
        const workouts = (await Promise.all(workoutPromises)).filter(Boolean);
        return this._sortWorkoutsByDate(workouts);
      }

      const snapshot = await db.collection('workouts')
        .where('studentId', '==', targetId)
        .limit(50)
        .get();

      const workouts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return this._sortWorkoutsByDate(workouts);

    } catch (error) {
      console.error('[db] Erro ao obter treinos do aluno:', error);
      return [];
    }
  }

  async getWorkout(workoutId) {
    try {
      const doc = await db.collection('workouts').doc(workoutId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('[db] Erro ao obter treino:', error);
      return null;
    }
  }

  async getWorkoutById(workoutId) {
    return await this.getWorkout(workoutId);
  }

  async getWorkoutsMap(workoutIds) {
    if (!workoutIds || workoutIds.length === 0) return {};
    const uniqueIds = [...new Set(workoutIds)];
    const results   = await Promise.all(
      uniqueIds.map(id =>
        db.collection('workouts').doc(id).get()
          .then(doc => doc.exists ? [id, { id: doc.id, ...doc.data() }] : null)
          .catch(() => null)
      )
    );
    return Object.fromEntries(results.filter(Boolean));
  }

  async updateWorkout(workoutId, updates) {
    try {
      const cleanUpdates = {};
      for (const [key, value] of Object.entries(updates)) {
        cleanUpdates[key] = value === undefined ? '' : value;
      }
      await db.collection('workouts').doc(workoutId).update(cleanUpdates);
      return { success: true };
    } catch (error) {
      console.error('[db] Erro ao atualizar treino:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * deleteWorkout — PERF FIX: usa batch para consistência atômica.
   * Antes: update + delete separados podiam deixar assignedWorkouts inconsistente.
   * Agora: operações agrupadas em batch.
   */
  async deleteWorkout(workoutId) {
    try {
      const workout = await this.getWorkout(workoutId);
      const batch   = db.batch();

      if (workout?.studentId) {
        batch.update(db.collection('users').doc(workout.studentId), {
          assignedWorkouts: firebase.firestore.FieldValue.arrayRemove(workoutId),
        });
      }

      batch.delete(db.collection('workouts').doc(workoutId));

      await batch.commit();
      return { success: true };
    } catch (error) {
      console.error('[db] Erro ao deletar treino:', error);
      return { success: false, error: error.message };
    }
  }

  // ── Feedbacks ─────────────────────────────────────────────────────

  /**
   * createFeedback — PERF FIX: desnormaliza personalId.
   * Adiciona campo `personalId` para permitir query direta sem chunk por workoutId.
   */
  async createFeedback(feedbackData) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const weekIdentifier = feedbackData.weekIdentifier ||
        (window.feedbackModel?.getCurrentWeekIdentifier?.() || this._getWeekId());

      const feedbackKey = window.feedbackModel?.getFeedbackKey?.(
        user.uid, feedbackData.workoutId, weekIdentifier, feedbackData.dayOfWeek
      ) || `${user.uid}_${feedbackData.workoutId}_${weekIdentifier}_${feedbackData.dayOfWeek}`;

      const existing = await db.collection('feedbacks').doc(feedbackKey).get();
      if (existing.exists) {
        return { success: false, error: 'Você já enviou feedback para este dia nesta semana' };
      }

      // PERF: buscar personalId do workout para desnormalizar
      let personalId = '';
      try {
        const workoutDoc = await db.collection('workouts').doc(feedbackData.workoutId).get();
        if (workoutDoc.exists) {
          personalId = workoutDoc.data().personalId || '';
        }
      } catch { /* não crítico */ }

      await db.collection('feedbacks').doc(feedbackKey).set({
        id:             feedbackKey,
        studentId:      user.uid,
        workoutId:      feedbackData.workoutId     || '',
        personalId:     personalId,                        // campo desnormalizado
        weekIdentifier: weekIdentifier             || '',
        dayOfWeek:      feedbackData.dayOfWeek     || '',
        effortLevel:    feedbackData.effortLevel   || 5,
        sensation:      feedbackData.sensation     || 'ideal',
        hasPain:        feedbackData.hasPain       || false,
        painLocation:   feedbackData.hasPain ? (feedbackData.painLocation || '') : '',
        comment:        feedbackData.comment       || '',
        createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, id: feedbackKey };
    } catch (error) {
      console.error('[db] Erro ao criar feedback:', error);
      return { success: false, error: error.message };
    }
  }

  async submitFeedback(data) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const weekId    = this._getWeekId();
      const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const key       = `${user.uid}_${data.workoutId}_${weekId}_${dayOfWeek}`;

      // PERF: desnormalizar personalId
      let personalId = '';
      try {
        const workoutDoc = await db.collection('workouts').doc(data.workoutId).get();
        if (workoutDoc.exists) personalId = workoutDoc.data().personalId || '';
      } catch { /* não crítico */ }

      await db.collection('feedbacks').doc(key).set({
        id:             key,
        studentId:      user.uid,
        workoutId:      data.workoutId    || '',
        personalId:     personalId,
        workoutName:    data.workoutName  || '',
        weekIdentifier: weekId,
        dayOfWeek,
        effortLevel:    data.effort       || 5,
        sensation:      data.sensation    || 'ideal',
        hasPain:        data.hasPain      || false,
        painLocation:   data.painLocation || '',
        comment:        data.comment      || '',
        date:           data.date         || new Date().toISOString(),
        createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (error) {
      console.error('[db] Erro ao submeter feedback:', error);
      return { success: false, error: error.message };
    }
  }

  async hasFeedbackForDay(workoutId, dayOfWeek, weekIdentifier) {
    try {
      const user   = authManager.getCurrentUser();
      if (!user) return false;
      const weekId = weekIdentifier ||
        (window.feedbackModel?.getCurrentWeekIdentifier?.() || this._getWeekId());
      const key    = window.feedbackModel?.getFeedbackKey?.(user.uid, workoutId, weekId, dayOfWeek)
        || `${user.uid}_${workoutId}_${weekId}_${dayOfWeek}`;
      const doc = await db.collection('feedbacks').doc(key).get();
      return doc.exists;
    } catch {
      return false;
    }
  }

  async getStudentFeedbacks(studentId, { limit = 50, startAfter = null } = {}) {
    try {
      const user     = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');
      const targetId = studentId || user.uid;

      let query = db.collection('feedbacks')
        .where('studentId', '==', targetId)
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (startAfter) query = query.startAfter(startAfter);

      const snapshot = await query.get();
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error('[db] Erro ao obter feedbacks:', error);
      return [];
    }
  }

  /**
   * getPersonalFeedbacks — PERF FIX: estratégia dupla.
   *
   * Estratégia 1 (preferida): query direta por personalId (índice simples).
   *   Requer campo `personalId` desnormalizado nos documentos de feedback.
   *   Criado automaticamente pelo createFeedback() desta versão.
   *
   * Estratégia 2 (fallback): chunk queries por workoutId (comportamento anterior).
   *   Usado para feedbacks antigos que não têm personalId desnormalizado.
   */
  async getPersonalFeedbacks({ feedbackLimit = 500 } = {}) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Estratégia 1: query direta por personalId
      try {
        const snap = await db.collection('feedbacks')
          .where('personalId', '==', user.uid)
          .orderBy('createdAt', 'desc')
          .limit(feedbackLimit)
          .get();

        if (!snap.empty) {
          return snap.docs.map(doc => doc.data());
        }
        // Se vazio, pode ser que feedbacks antigos não tenham personalId
        // Continua para fallback
      } catch (err) {
        const isIndexError = err.code === 'failed-precondition' ||
          (err.message || '').includes('index');
        if (!isIndexError) {
          console.warn('[db] Erro na query por personalId:', err.message);
        }
        // Fallback para chunk query
      }

      // Estratégia 2: fallback via chunk queries por workoutId
      console.warn('[db] Usando fallback chunk query para feedbacks. ' +
        'Adicione índice personalId+createdAt na coleção feedbacks para melhor performance.');

      const workoutsSnapshot = await db.collection('workouts')
        .where('personalId', '==', user.uid)
        .limit(200)
        .get();

      const workoutIds = workoutsSnapshot.docs.map(doc => doc.id);
      if (workoutIds.length === 0) return [];

      const CHUNK_SIZE = 10;
      const chunks     = [];
      for (let i = 0; i < workoutIds.length; i += CHUNK_SIZE) {
        chunks.push(workoutIds.slice(i, i + CHUNK_SIZE));
      }

      const chunkSnapshots = await Promise.all(
        chunks.map(async chunk => {
          try {
            return await db.collection('feedbacks')
              .where('workoutId', 'in', chunk)
              .orderBy('createdAt', 'desc')
              .limit(Math.ceil(feedbackLimit / chunks.length))
              .get();
          } catch (err) {
            const isIndexError = err.code === 'failed-precondition' ||
              (err.message || '').includes('index');
            if (isIndexError) {
              return db.collection('feedbacks')
                .where('workoutId', 'in', chunk)
                .limit(Math.ceil(feedbackLimit / chunks.length))
                .get()
                .catch(() => ({ docs: [] }));
            }
            console.warn('[db] Erro em chunk de feedbacks:', err.message);
            return { docs: [] };
          }
        })
      );

      const seen         = new Set();
      const allFeedbacks = [];

      chunkSnapshots.forEach(snap => {
        snap.docs.forEach(doc => {
          if (!seen.has(doc.id)) {
            seen.add(doc.id);
            allFeedbacks.push(doc.data());
          }
        });
      });

      allFeedbacks.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        const aS = a.createdAt.seconds || 0;
        const bS = b.createdAt.seconds || 0;
        return bS - aS;
      });

      return allFeedbacks;
    } catch (error) {
      console.error('[db] Erro ao obter feedbacks do personal:', error);
      return [];
    }
  }

  async getFeedback(feedbackId) {
    try {
      const doc = await db.collection('feedbacks').doc(feedbackId).get();
      return doc.exists ? doc.data() : null;
    } catch {
      return null;
    }
  }

  // ── Helpers internos ──────────────────────────────────────────────

  _getWeekId() {
    const now         = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const pastDays    = (now - startOfYear) / 86400000;
    const weekNumber  = Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-${weekNumber}`;
  }
}

const dbManager = new DatabaseManager();
window.dbManager = dbManager;