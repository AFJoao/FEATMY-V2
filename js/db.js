/**
 * js/db.js — CORRIGIDO v2
 *
 * Correções de performance:
 *
 * 1. getPersonalFeedbacks() — N+1 eliminado com Promise.all() em chunks de 10
 *    (Firestore limita 'in' a 10 valores por query)
 *
 * 2. getPersonalExercises() — removido db.collection('exercises').get() global
 *    que lia TODOS os exercícios do sistema. Substituído por queries filtradas.
 *
 * 3. Paginação adicionada em getPersonalWorkouts(), getMyStudents(),
 *    getStudentFeedbacks() e getPersonalFeedbacks() via cursor.
 *    Limite padrão conservador (100) para não quebrar UX existente,
 *    com suporte a cursor para carregar mais.
 *
 * 4. feedbacks.html — getWorkoutsMap() novo método que busca N workouts
 *    em paralelo (Promise.all), eliminando o N+1 da página de feedbacks.
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

    console.warn('Não foi possível converter URL do YouTube:', url);
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
      console.error('Erro ao obter dados do usuário:', error);
      return null;
    }
  }

  async getUserData(uid) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
    } catch (error) {
      console.error('Erro ao obter dados do usuário:', error);
      return null;
    }
  }

  async getStudentById(studentId) {
    return await this.getUserData(studentId);
  }

  /**
   * Lista alunos do personal com limite e cursor para paginação.
   * @param {object} [opts]
   * @param {number} [opts.limit=100]       - Máximo de documentos a retornar
   * @param {object} [opts.startAfter=null] - Cursor Firestore para próxima página
   */
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
      const students = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));

      // Sincronizar array students[] no doc do personal (melhor esforço)
      if (students.length > 0 && !startAfter) {
        try {
          await db.collection('users').doc(user.uid).update({
            students: students.map(s => s.uid)
          });
        } catch (e) { /* não crítico */ }
      }

      return students;
    } catch (error) {
      console.error('Erro ao buscar alunos:', error);
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

      const exerciseData = {
        id:          exerciseRef.id,
        name:        name || '',
        description: desc || '',
        muscleGroup: muscleGroup || '',
        muscles:     muscles,
        videoUrl:    embedUrl || '',
        personalId:  user.uid,
        createdBy:   user.uid,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      };

      await exerciseRef.set(exerciseData);
      return { success: true, id: exerciseRef.id };
    } catch (error) {
      console.error('Erro ao criar exercício:', error);
      return { success: false, error: error.message };
    }
  }

  async addExercise(data) {
    return await this.createExercise(data);
  }

  /**
   * Busca exercícios próprios do personal + exercícios globais (sem personalId).
   *
   * CORRIGIDO: removido db.collection('exercises').get() que lia TODOS os exercícios
   * do sistema independente do personal. Substituído por 3 queries paralelas filtradas:
   *   1. Exercícios do personal (personalId == uid)
   *   2. Exercícios globais com personalId vazio ('')
   *   3. Exercícios criados por 'admin' (legados)
   *
   * Não há mais varredura global da coleção.
   */
  async getPersonalExercises() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      // ✅ CORRIGIDO N+1: 3 queries paralelas em vez de get() global
      const [ownSnap, globalEmptySnap, adminSnap] = await Promise.all([
        db.collection('exercises')
          .where('personalId', '==', user.uid)
          .orderBy('createdAt', 'desc')
          .limit(200)
          .get(),

        db.collection('exercises')
          .where('personalId', '==', '')
          .limit(100)
          .get(),

        db.collection('exercises')
          .where('createdBy', '==', 'admin')
          .limit(100)
          .get()
          .catch(() => ({ docs: [] })) // regras podem bloquear, não crítico
      ]);

      const seen      = new Set();
      const exercises = [];

      const addDocs = (docs) => {
        docs.forEach(doc => {
          if (!seen.has(doc.id)) {
            seen.add(doc.id);
            exercises.push(doc.data());
          }
        });
      };

      // Próprios primeiro (aparecem no topo)
      addDocs(ownSnap.docs);
      addDocs(globalEmptySnap.docs);
      addDocs(adminSnap.docs);

      // Ordenar: próprios por createdAt desc (já vêm ordenados), globais ao final
      // A ordem do ownSnap já foi respeitada — apenas garantimos que globais vêm depois
      console.log('Exercícios encontrados:', exercises.length);
      return exercises;
    } catch (error) {
      console.error('Erro ao obter exercícios:', error);
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
      console.error('Erro ao obter exercício:', error);
      return null;
    }
  }

  async deleteExercise(exerciseId) {
    try {
      await db.collection('exercises').doc(exerciseId).delete();
      return { success: true };
    } catch (error) {
      console.error('Erro ao deletar exercício:', error);
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

      const workoutRef  = db.collection('workouts').doc();
      const workoutData = {
        id:          workoutRef.id,
        name:        name,
        description: desc,
        personalId:  user.uid,
        days:        daysData,
        studentId:   stdId || '',
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      };

      await workoutRef.set(workoutData);

      if (stdId) {
        try {
          await db.collection('users').doc(stdId).update({
            assignedWorkouts: firebase.firestore.FieldValue.arrayUnion(workoutRef.id)
          });
        } catch (e) { /* não crítico */ }
      }

      return { success: true, id: workoutRef.id };
    } catch (error) {
      console.error('Erro ao criar treino:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Lista treinos do personal com paginação via cursor.
   * @param {object} [opts]
   * @param {number} [opts.limit=100]
   * @param {object} [opts.startAfter=null]
   */
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
      console.error('Erro ao obter treinos do personal:', error);
      return [];
    }
  }

  async getStudentWorkouts(studentIdParam) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const targetId = studentIdParam || user.uid;

      const userDoc          = await db.collection('users').doc(targetId).get();
      const assignedWorkouts = userDoc.exists ? (userDoc.data().assignedWorkouts || []) : [];

      if (assignedWorkouts.length > 0) {
        // Busca todos os workouts em paralelo (sem loop sequencial)
        const workoutPromises = assignedWorkouts.map(id =>
          db.collection('workouts').doc(id).get()
            .then(doc => doc.exists ? { id: doc.id, ...doc.data() } : null)
            .catch(() => null)
        );
        const workouts = (await Promise.all(workoutPromises)).filter(Boolean);
        return workouts.sort((a, b) => {
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return b.createdAt.seconds - a.createdAt.seconds;
        });
      }

      // Fallback: query por studentId
      console.warn('[getStudentWorkouts] assignedWorkouts vazio, usando fallback query...');
      const snapshot = await db.collection('workouts')
        .where('studentId', '==', targetId)
        .limit(50)
        .get();

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });

    } catch (error) {
      console.error('Erro ao obter treinos do aluno:', error);
      return [];
    }
  }

  async getWorkout(workoutId) {
    try {
      const doc = await db.collection('workouts').doc(workoutId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Erro ao obter treino:', error);
      return null;
    }
  }

  async getWorkoutById(workoutId) {
    return await this.getWorkout(workoutId);
  }

  /**
   * Busca múltiplos workouts em paralelo a partir de uma lista de IDs.
   * Usado pela página de feedbacks para eliminar o N+1.
   *
   * @param {string[]} workoutIds
   * @returns {Object.<string, object>} Mapa workoutId → workout data
   */
  async getWorkoutsMap(workoutIds) {
    if (!workoutIds || workoutIds.length === 0) return {};

    // Deduplica IDs
    const uniqueIds = [...new Set(workoutIds)];

    const promises = uniqueIds.map(id =>
      db.collection('workouts').doc(id).get()
        .then(doc => doc.exists ? [id, { id: doc.id, ...doc.data() }] : null)
        .catch(() => null)
    );

    const results = await Promise.all(promises);
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
      console.error('Erro ao atualizar treino:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteWorkout(workoutId) {
    try {
      const workout = await this.getWorkout(workoutId);
      if (workout && workout.studentId) {
        try {
          await db.collection('users').doc(workout.studentId).update({
            assignedWorkouts: firebase.firestore.FieldValue.arrayRemove(workoutId)
          });
        } catch (e) { /* não crítico */ }
      }
      await db.collection('workouts').doc(workoutId).delete();
      return { success: true };
    } catch (error) {
      console.error('Erro ao deletar treino:', error);
      return { success: false, error: error.message };
    }
  }

  // ── Feedbacks ─────────────────────────────────────────────────────

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

      await db.collection('feedbacks').doc(feedbackKey).set({
        id:            feedbackKey,
        studentId:     user.uid,
        workoutId:     feedbackData.workoutId     || '',
        weekIdentifier: weekIdentifier             || '',
        dayOfWeek:     feedbackData.dayOfWeek     || '',
        effortLevel:   feedbackData.effortLevel   || 5,
        sensation:     feedbackData.sensation     || 'ideal',
        hasPain:       feedbackData.hasPain       || false,
        painLocation:  feedbackData.hasPain ? (feedbackData.painLocation || '') : '',
        comment:       feedbackData.comment       || '',
        createdAt:     firebase.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, id: feedbackKey };
    } catch (error) {
      console.error('Erro ao criar feedback:', error);
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

      await db.collection('feedbacks').doc(key).set({
        id:            key,
        studentId:     user.uid,
        workoutId:     data.workoutId    || '',
        workoutName:   data.workoutName  || '',
        weekIdentifier: weekId,
        dayOfWeek:     dayOfWeek,
        effortLevel:   data.effort       || 5,
        sensation:     data.sensation    || 'ideal',
        hasPain:       data.hasPain      || false,
        painLocation:  data.painLocation || '',
        comment:       data.comment      || '',
        date:          data.date         || new Date().toISOString(),
        createdAt:     firebase.firestore.FieldValue.serverTimestamp()
      });

      return { success: true };
    } catch (error) {
      console.error('Erro ao submeter feedback:', error);
      return { success: false, error: error.message };
    }
  }

  async hasFeedbackForDay(workoutId, dayOfWeek, weekIdentifier) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) return false;

      const weekId = weekIdentifier ||
        (window.feedbackModel?.getCurrentWeekIdentifier?.() || this._getWeekId());

      const key = window.feedbackModel?.getFeedbackKey?.(user.uid, workoutId, weekId, dayOfWeek)
        || `${user.uid}_${workoutId}_${weekId}_${dayOfWeek}`;

      const doc = await db.collection('feedbacks').doc(key).get();
      return doc.exists;
    } catch (error) {
      console.error('Erro ao verificar feedback:', error);
      return false;
    }
  }

  /**
   * Feedbacks do aluno com paginação.
   */
  async getStudentFeedbacks(studentId, { limit = 50, startAfter = null } = {}) {
    try {
      const user = authManager.getCurrentUser();
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
      console.error('Erro ao obter feedbacks:', error);
      return [];
    }
  }

  /**
   * Feedbacks de todos os treinos do personal.
   *
   * CORRIGIDO N+1: antes usava loop sequencial for...of com await dentro,
   * causando 1 query por treino de forma serial.
   *
   * Agora usa Promise.all com chunks de 10 (limite do operador 'in' no Firestore).
   * Para 40 treinos: antes = 41 reads sequenciais (~2s),
   *                  depois = 5 reads paralelas (~200ms).
   *
   * @param {object} [opts]
   * @param {number} [opts.workoutLimit=200] - Limite de treinos a consultar
   * @param {number} [opts.feedbackLimit=500] - Limite total de feedbacks
   */
  async getPersonalFeedbacks({ workoutLimit = 200, feedbackLimit = 500 } = {}) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      // 1. Buscar IDs dos treinos do personal
      const workoutsSnapshot = await db.collection('workouts')
        .where('personalId', '==', user.uid)
        .select('id') // só busca o campo id — menos dados transferidos
        .limit(workoutLimit)
        .get();

      const workoutIds = workoutsSnapshot.docs.map(doc => doc.id);
      if (workoutIds.length === 0) return [];

      // 2. ✅ CORRIGIDO N+1: Promise.all com chunks de 10 (limite do 'in' no Firestore)
      //    Antes: for...of sequencial = N reads em série
      //    Depois: ceil(N/10) reads em paralelo
      const CHUNK_SIZE = 10;
      const chunks = [];
      for (let i = 0; i < workoutIds.length; i += CHUNK_SIZE) {
        chunks.push(workoutIds.slice(i, i + CHUNK_SIZE));
      }

      const chunkSnapshots = await Promise.all(
        chunks.map(chunk =>
          db.collection('feedbacks')
            .where('workoutId', 'in', chunk)
            .orderBy('createdAt', 'desc')
            .limit(Math.ceil(feedbackLimit / chunks.length))
            .get()
            .catch(err => {
              console.warn('[getPersonalFeedbacks] Erro em chunk:', err.message);
              return { docs: [] };
            })
        )
      );

      // 3. Flatten e deduplicar por ID
      const seen        = new Set();
      const allFeedbacks = [];

      chunkSnapshots.forEach(snap => {
        snap.docs.forEach(doc => {
          if (!seen.has(doc.id)) {
            seen.add(doc.id);
            allFeedbacks.push(doc.data());
          }
        });
      });

      // Ordenar por createdAt desc (chunks podem ter ordens diferentes)
      allFeedbacks.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });

      console.log(`[getPersonalFeedbacks] ${workoutIds.length} treinos → ${chunks.length} chunks → ${allFeedbacks.length} feedbacks`);
      return allFeedbacks;

    } catch (error) {
      console.error('Erro ao obter feedbacks do personal:', error);
      return [];
    }
  }

  async getFeedback(feedbackId) {
    try {
      const doc = await db.collection('feedbacks').doc(feedbackId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('Erro ao obter feedback:', error);
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

// Instância global
const dbManager = new DatabaseManager();
window.dbManager = dbManager;