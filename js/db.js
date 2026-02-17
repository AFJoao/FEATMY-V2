/**
 * Módulo de Banco de Dados - CORRIGIDO
 * Operações com Firestore para usuários, exercícios e treinos
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

  // Alias para getUserData (usado em student-details.html)
  async getStudentById(studentId) {
    return await this.getUserData(studentId);
  }

  async getMyStudents() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) return [];

      console.log('=== BUSCANDO ALUNOS ===', user.uid);

      const snapshot = await db.collection('users')
        .where('personalId', '==', user.uid)
        .where('userType', '==', 'student')
        .get();

      const students = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
      console.log('Alunos encontrados:', students.length);

      if (students.length > 0) {
        try {
          await db.collection('users').doc(user.uid).update({
            students: students.map(s => s.uid)
          });
        } catch (e) { /* não crítico */ }
      }

      return students;
    } catch (error) {
      console.error('=== ERRO AO BUSCAR ALUNOS ===', error);
      return [];
    }
  }

  // Alias
  async getAllStudents() {
    return await this.getMyStudents();
  }

  // ── Exercises ─────────────────────────────────────────────────────

  /**
   * Criar exercício (aceita objeto ou parâmetros individuais)
   */
  async createExercise(nameOrObj, description, videoUrl) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      let name, desc, vUrl, muscleGroup;

      if (typeof nameOrObj === 'object') {
        name = nameOrObj.name;
        desc = nameOrObj.description || '';
        vUrl = nameOrObj.videoUrl || '';
        muscleGroup = nameOrObj.muscleGroup || '';
      } else {
        name = nameOrObj;
        desc = description || '';
        vUrl = videoUrl || '';
        muscleGroup = '';
      }

      const embedUrl = this.convertYouTubeUrl(vUrl);
      const exerciseRef = db.collection('exercises').doc();

      const exerciseData = {
        id: exerciseRef.id,
        name,
        description: desc,
        muscleGroup,
        videoUrl: embedUrl,
        personalId: user.uid,
        createdBy: user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      await exerciseRef.set(exerciseData);
      console.log('✓ Exercício criado:', name);
      return { success: true, id: exerciseRef.id };
    } catch (error) {
      console.error('Erro ao criar exercício:', error);
      return { success: false, error: error.message };
    }
  }

  // Alias usado em exercises.html
  async addExercise(data) {
    return await this.createExercise(data);
  }

  async getPersonalExercises() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Tenta por createdBy primeiro, fallback para personalId
      let snapshot = await db.collection('exercises')
        .where('createdBy', '==', user.uid)
        .get();

      // Se não encontrou, tenta personalId (compatibilidade)
      if (snapshot.empty) {
        snapshot = await db.collection('exercises')
          .where('personalId', '==', user.uid)
          .get();
      }

      const exercises = snapshot.docs.map(doc => doc.data()).sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });

      console.log('Exercícios encontrados:', exercises.length);
      return exercises;
    } catch (error) {
      console.error('Erro ao obter exercícios:', error);
      return [];
    }
  }

  // Alias usado em exercises.html
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

  /**
   * Criar treino (aceita objeto ou parâmetros individuais)
   */
  async createWorkout(nameOrObj, description, days, studentId) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      let name, desc, daysData, stdId;

      if (typeof nameOrObj === 'object') {
        name = nameOrObj.name;
        desc = nameOrObj.description || '';
        daysData = nameOrObj.days || {};
        stdId = nameOrObj.studentId || null;
      } else {
        name = nameOrObj;
        desc = description || '';
        daysData = days || {};
        stdId = studentId || null;
      }

      const workoutRef = db.collection('workouts').doc();
      await workoutRef.set({
        id: workoutRef.id,
        name,
        description: desc,
        personalId: user.uid,
        studentId: stdId,
        days: daysData,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

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

  async getPersonalWorkouts() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const snapshot = await db.collection('workouts')
        .where('personalId', '==', user.uid)
        .get();

      return snapshot.docs.map(doc => doc.data()).sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });
    } catch (error) {
      console.error('Erro ao obter treinos do personal:', error);
      return [];
    }
  }

  /**
   * Busca treinos do aluno.
   * Estratégia: lê assignedWorkouts do doc do aluno -> busca cada workout por ID (get direto).
   * Isso evita query em coleção que falha nas regras do Firestore.
   * Fallback: tenta query .where('studentId') caso assignedWorkouts esteja vazio.
   */
  async getStudentWorkouts(studentIdParam) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const targetId = studentIdParam || user.uid;

      // Estratégia 1: usar assignedWorkouts do perfil do aluno (get direto, sem query)
      const userDoc = await db.collection('users').doc(targetId).get();
      const assignedWorkouts = userDoc.exists ? (userDoc.data().assignedWorkouts || []) : [];

      if (assignedWorkouts.length > 0) {
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

      // Estratégia 2 (fallback): query direta — só funciona se rules permitirem list
      console.warn('[getStudentWorkouts] assignedWorkouts vazio, tentando query fallback...');
      const snapshot = await db.collection('workouts')
        .where('studentId', '==', targetId)
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

  // Alias
  async getWorkoutById(workoutId) {
    return await this.getWorkout(workoutId);
  }

  async updateWorkout(workoutId, updates) {
    try {
      await db.collection('workouts').doc(workoutId).update(updates);
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

      // Verificar duplicata
      const existing = await db.collection('feedbacks').doc(feedbackKey).get();
      if (existing.exists) {
        return { success: false, error: 'Você já enviou feedback para este dia nesta semana' };
      }

      await db.collection('feedbacks').doc(feedbackKey).set({
        id: feedbackKey,
        studentId: user.uid,
        workoutId: feedbackData.workoutId,
        weekIdentifier,
        dayOfWeek: feedbackData.dayOfWeek,
        effortLevel: feedbackData.effortLevel,
        sensation: feedbackData.sensation,
        hasPain: feedbackData.hasPain,
        painLocation: feedbackData.hasPain ? (feedbackData.painLocation || '') : '',
        comment: feedbackData.comment || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, id: feedbackKey };
    } catch (error) {
      console.error('Erro ao criar feedback:', error);
      return { success: false, error: error.message };
    }
  }

  // Alias usado em view-workout.html (dados diferentes, salva como antes)
  async submitFeedback(data) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const weekId = this._getWeekId();
      const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const key = `${user.uid}_${data.workoutId}_${weekId}_${dayOfWeek}`;

      await db.collection('feedbacks').doc(key).set({
        id: key,
        studentId: user.uid,
        workoutId: data.workoutId || '',
        workoutName: data.workoutName || '',
        weekIdentifier: weekId,
        dayOfWeek,
        effortLevel: data.effort || 5,
        sensation: data.sensation || 'ideal',
        hasPain: data.hasPain || false,
        painLocation: data.painLocation || '',
        comment: data.comment || '',
        date: data.date || new Date().toISOString(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
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

  async getStudentFeedbacks(studentId) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const targetId = studentId || user.uid;

      const snapshot = await db.collection('feedbacks')
        .where('studentId', '==', targetId)
        .get();

      return snapshot.docs.map(doc => doc.data()).sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });
    } catch (error) {
      console.error('Erro ao obter feedbacks:', error);
      return [];
    }
  }

  async getPersonalFeedbacks() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      console.log('=== GET PERSONAL FEEDBACKS ===', user.uid);

      // Busca treinos do personal
      const workoutsSnapshot = await db.collection('workouts')
        .where('personalId', '==', user.uid)
        .get();

      const workoutIds = workoutsSnapshot.docs.map(doc => doc.id);
      console.log('Workouts encontrados:', workoutIds.length);

      if (workoutIds.length === 0) return [];

      const allFeedbacks = [];
      for (const workoutId of workoutIds) {
        try {
          const feedbackSnapshot = await db.collection('feedbacks')
            .where('workoutId', '==', workoutId)
            .get();
          feedbackSnapshot.docs.forEach(doc => allFeedbacks.push(doc.data()));
        } catch (e) {
          console.warn('Erro no workout', workoutId, e);
        }
      }

      console.log('Total feedbacks:', allFeedbacks.length);
      return allFeedbacks.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });
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
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const pastDaysOfYear = (now - startOfYear) / 86400000;
    const weekNumber = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-${weekNumber}`;
  }
}

// Instância global
const dbManager = new DatabaseManager();
window.dbManager = dbManager;