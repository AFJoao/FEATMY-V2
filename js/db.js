/**
 * Módulo de Banco de Dados
 * Operações com Firestore para usuários, exercícios e treinos
 */

class DatabaseManager {
  /**
   * Converter URL do YouTube para formato embed
   */
  convertYouTubeUrl(url) {
    if (!url || url.trim() === '') return '';
    
    // Se já está no formato embed, retornar como está
    if (url.includes('/embed/')) {
      return url;
    }
    
    // Extrair ID do vídeo de diferentes formatos de URL
    let videoId = null;
    
    // Formato: youtube.com/watch?v=VIDEO_ID
    const watchMatch = url.match(/[?&]v=([^&]+)/);
    if (watchMatch) {
      videoId = watchMatch[1];
    }
    
    // Formato: youtu.be/VIDEO_ID
    const shortMatch = url.match(/youtu\.be\/([^?]+)/);
    if (shortMatch) {
      videoId = shortMatch[1];
    }
    
    // Formato: youtube.com/embed/VIDEO_ID (já tratado acima, mas por segurança)
    const embedMatch = url.match(/\/embed\/([^?]+)/);
    if (embedMatch) {
      videoId = embedMatch[1];
    }
    
    // Se encontrou o ID, retornar URL embed
    if (videoId) {
      // Remover qualquer parâmetro extra do ID
      videoId = videoId.split('&')[0].split('?')[0];
      return `https://www.youtube.com/embed/${videoId}`;
    }
    
    // Se não conseguiu converter, retornar URL original
    console.warn('Não foi possível converter URL do YouTube:', url);
    return url;
  }

  /**
   * Obter dados do usuário atual
   */
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

  /**
   * Obter dados de um usuário específico
   */
  async getUserData(uid) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
    } catch (error) {
      console.error('Erro ao obter dados do usuário:', error);
      return null;
    }
  }

  /**
   * Obter alunos vinculados ao Personal atual
   */
  async getMyStudents() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) {
        console.log('Usuário não autenticado');
        return [];
      }

      console.log('=== BUSCANDO ALUNOS ===');
      console.log('Personal UID:', user.uid);

      const snapshot = await db.collection('users')
        .where('personalId', '==', user.uid)
        .where('userType', '==', 'student')
        .get();

      console.log('Documentos encontrados:', snapshot.docs.length);

      const students = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log('Aluno encontrado:', doc.id, data.name);
        students.push({
          uid: doc.id,
          ...data
        });
      });

      console.log('Total de alunos:', students.length);

      if (students.length > 0) {
        const studentIds = students.map(s => s.uid);
        try {
          await db.collection('users').doc(user.uid).update({
            students: studentIds
          });
          console.log('Lista de alunos atualizada no Personal');
        } catch (updateError) {
          console.error('Erro ao atualizar lista:', updateError);
        }
      }

      return students;
    } catch (error) {
      console.error('=== ERRO AO BUSCAR ALUNOS ===');
      console.error('Erro completo:', error);
      return [];
    }
  }

  /**
   * Criar novo exercício (com conversão automática de URL)
   */
  async createExercise(name, description, videoUrl) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      console.log('=== CRIANDO EXERCÍCIO ===');
      console.log('Nome:', name);
      console.log('URL original:', videoUrl);

      // Converter URL do YouTube automaticamente
      const embedUrl = this.convertYouTubeUrl(videoUrl);
      console.log('URL convertida:', embedUrl);

      const exerciseRef = db.collection('exercises').doc();
      const exerciseData = {
        id: exerciseRef.id,
        name: name,
        description: description || '',
        videoUrl: embedUrl,
        createdBy: user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      console.log('Dados a salvar:', exerciseData);

      await exerciseRef.set(exerciseData);
      console.log('✓ Exercício criado com sucesso!');

      return {
        success: true,
        id: exerciseRef.id
      };
    } catch (error) {
      console.error('=== ERRO AO CRIAR EXERCÍCIO ===');
      console.error('Erro completo:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obter exercícios do Personal Trainer atual (CORRIGIDO - sem orderBy)
   */
  async getPersonalExercises() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      console.log('=== BUSCANDO EXERCÍCIOS ===');
      console.log('Personal UID:', user.uid);

      // REMOVIDO orderBy para evitar erro de índice
      const snapshot = await db.collection('exercises')
        .where('createdBy', '==', user.uid)
        .get();

      console.log('Exercícios encontrados:', snapshot.docs.length);

      // Ordenar manualmente por data de criação (mais recentes primeiro)
      const exercises = snapshot.docs.map(doc => {
        const data = doc.data();
        console.log('Exercício:', data.name, '- ID:', data.id);
        return data;
      }).sort((a, b) => {
        // Se não tem createdAt, colocar no final
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        // Ordenar do mais recente para o mais antigo
        return b.createdAt.seconds - a.createdAt.seconds;
      });

      console.log('Total após ordenação:', exercises.length);

      return exercises;
    } catch (error) {
      console.error('=== ERRO AO OBTER EXERCÍCIOS ===');
      console.error('Erro completo:', error);
      return [];
    }
  }

  /**
   * Obter exercício específico
   */
  async getExercise(exerciseId) {
    try {
      const doc = await db.collection('exercises').doc(exerciseId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('Erro ao obter exercício:', error);
      return null;
    }
  }

  /**
   * Deletar exercício
   */
  async deleteExercise(exerciseId) {
    try {
      await db.collection('exercises').doc(exerciseId).delete();
      return { success: true };
    } catch (error) {
      console.error('Erro ao deletar exercício:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Criar novo treino
   */
  async createWorkout(name, description, days, studentId = null) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      const workoutRef = db.collection('workouts').doc();
      await workoutRef.set({
        id: workoutRef.id,
        name: name,
        description: description,
        personalId: user.uid,
        studentId: studentId || null,
        days: days,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      if (studentId) {
        await db.collection('users').doc(studentId).update({
          assignedWorkouts: firebase.firestore.FieldValue.arrayUnion(workoutRef.id)
        });
      }

      return {
        success: true,
        id: workoutRef.id
      };
    } catch (error) {
      console.error('Erro ao criar treino:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obter treinos do Personal Trainer atual (CORRIGIDO - sem orderBy)
   */
  async getPersonalWorkouts() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      // REMOVIDO orderBy para evitar erro de índice
      const snapshot = await db.collection('workouts')
        .where('personalId', '==', user.uid)
        .get();

      // Ordenar manualmente
      return snapshot.docs.map(doc => doc.data()).sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });
    } catch (error) {
      console.error('Erro ao obter treinos:', error);
      return [];
    }
  }

  /**
   * Obter treinos do Aluno atual (CORRIGIDO - sem orderBy)
   */
  async getStudentWorkouts() {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      // REMOVIDO orderBy para evitar erro de índice
      const snapshot = await db.collection('workouts')
        .where('studentId', '==', user.uid)
        .get();

      // Ordenar manualmente
      return snapshot.docs.map(doc => doc.data()).sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });
    } catch (error) {
      console.error('Erro ao obter treinos:', error);
      return [];
    }
  }

  /**
   * Obter treino específico
   */
  async getWorkout(workoutId) {
    try {
      const doc = await db.collection('workouts').doc(workoutId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('Erro ao obter treino:', error);
      return null;
    }
  }

  /**
   * Deletar treino
   */
  async deleteWorkout(workoutId) {
    try {
      const workout = await this.getWorkout(workoutId);
      
      if (workout && workout.studentId) {
        await db.collection('users').doc(workout.studentId).update({
          assignedWorkouts: firebase.firestore.FieldValue.arrayRemove(workoutId)
        });
      }

      await db.collection('workouts').doc(workoutId).delete();
      return { success: true };
    } catch (error) {
      console.error('Erro ao deletar treino:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obter todos os alunos vinculados
   */
  async getAllStudents() {
    return await this.getMyStudents();
  }

  /**
   * Atualizar treino
   */
  async updateWorkout(workoutId, updates) {
    try {
      await db.collection('workouts').doc(workoutId).update(updates);
      return { success: true };
    } catch (error) {
      console.error('Erro ao atualizar treino:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obter treino por ID do Firestore
   */
  async getWorkoutById(workoutId) {
    try {
      const doc = await db.collection('workouts').doc(workoutId).get();
      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (error) {
      console.error('Erro ao obter treino:', error);
      return null;
    }
  }

  /**
   * Criar feedback de treino
   */
  async createFeedback(feedbackData) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Adicionar studentId aos dados (não vem do formulário)
      const feedbackDataWithStudent = {
        ...feedbackData,
        studentId: user.uid
      };

      // Validar dados (agora com studentId)
      if (typeof window.feedbackModel !== 'undefined') {
        const validation = window.feedbackModel.validateFeedbackData(feedbackDataWithStudent);
        if (!validation.isValid) {
          return {
            success: false,
            error: validation.errors.join(', ')
          };
        }
      }

      // Verificar se já existe feedback para este dia/semana
      const weekIdentifier = feedbackData.weekIdentifier || window.feedbackModel?.getCurrentWeekIdentifier();
      const feedbackKey = window.feedbackModel?.getFeedbackKey(
        user.uid,
        feedbackData.workoutId,
        weekIdentifier,
        feedbackData.dayOfWeek
      );

      // Verificar se já existe
      const existingDoc = await db.collection('feedbacks').doc(feedbackKey).get();
      if (existingDoc.exists) {
        return {
          success: false,
          error: 'Você já enviou feedback para este dia nesta semana'
        };
      }

      // Criar feedback
      await db.collection('feedbacks').doc(feedbackKey).set({
        id: feedbackKey,
        studentId: user.uid,
        workoutId: feedbackData.workoutId,
        weekIdentifier: weekIdentifier,
        dayOfWeek: feedbackData.dayOfWeek,
        effortLevel: feedbackData.effortLevel,
        sensation: feedbackData.sensation,
        hasPain: feedbackData.hasPain,
        painLocation: feedbackData.hasPain ? (feedbackData.painLocation || '') : '',
        comment: feedbackData.comment || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      return {
        success: true,
        id: feedbackKey
      };
    } catch (error) {
      console.error('Erro ao criar feedback:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verificar se já existe feedback para um dia/semana específico
   */
  async hasFeedbackForDay(workoutId, dayOfWeek, weekIdentifier = null) {
    try {
      const user = authManager.getCurrentUser();
      if (!user) return false;

      const weekId = weekIdentifier || window.feedbackModel?.getCurrentWeekIdentifier();
      const feedbackKey = window.feedbackModel?.getFeedbackKey(
        user.uid,
        workoutId,
        weekId,
        dayOfWeek
      );

      const doc = await db.collection('feedbacks').doc(feedbackKey).get();
      return doc.exists;
    } catch (error) {
      console.error('Erro ao verificar feedback:', error);
      return false;
    }
  }

  /**
   * Obter feedbacks de um aluno específico
   */
  async getStudentFeedbacks(studentId = null) {
  try {
    const user = authManager.getCurrentUser();
    if (!user) throw new Error('Usuário não autenticado');

    const targetStudentId = studentId || user.uid;

    console.log('=== GET STUDENT FEEDBACKS ===');
    console.log('Current user:', user.uid);
    console.log('Target student:', targetStudentId);

    // ✅ Se está buscando seus próprios feedbacks (aluno)
    if (targetStudentId === user.uid) {
      console.log('→ Buscando feedbacks próprios');
      const snapshot = await db.collection('feedbacks')
        .where('studentId', '==', targetStudentId)
        .get();

      const feedbacks = snapshot.docs.map(doc => doc.data());
      console.log('✓ Feedbacks encontrados:', feedbacks.length);
      
      return feedbacks.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.seconds - a.createdAt.seconds;
      });
    }

    // Se é personal tentando buscar, não usar esta função
    console.warn('⚠️ Personal deve usar getPersonalFeedbacks()');
    return [];

  } catch (error) {
    console.error('Erro ao obter feedbacks:', error);
    throw error;
  }
}

  /**
   * Obter feedbacks de todos os alunos do personal
   */
  async getPersonalFeedbacks() {
  try {
    const user = authManager.getCurrentUser();
    if (!user) throw new Error('Usuário não autenticado');

    console.log('=== GET PERSONAL FEEDBACKS ===');
    console.log('Personal UID:', user.uid);

    // 1️⃣ Buscar workouts do personal
    const workoutsSnapshot = await db.collection('workouts')
      .where('personalId', '==', user.uid)
      .get();

    const workoutIds = workoutsSnapshot.docs.map(doc => doc.id);
    console.log('→ Workouts encontrados:', workoutIds.length);

    if (workoutIds.length === 0) {
      return [];
    }

    // 2️⃣ Buscar feedbacks por workoutId
    const allFeedbacks = [];
    
    for (const workoutId of workoutIds) {
      try {
        const feedbackSnapshot = await db.collection('feedbacks')
          .where('workoutId', '==', workoutId)
          .get();

        const feedbacks = feedbackSnapshot.docs.map(doc => doc.data());
        console.log(`  Workout ${workoutId}: ${feedbacks.length} feedbacks`);
        
        allFeedbacks.push(...feedbacks);
      } catch (err) {
        console.error(`Erro no workout ${workoutId}:`, err);
      }
    }

    console.log('✓ Total de feedbacks:', allFeedbacks.length);

    // 3️⃣ Ordenar
    return allFeedbacks.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.seconds - a.createdAt.seconds;
    });

  } catch (error) {
    console.error('Erro ao obter feedbacks do personal:', error);
    throw error;
  }
}

  /**
   * Obter feedback específico
   */
  async getFeedback(feedbackId) {
    try {
      const doc = await db.collection('feedbacks').doc(feedbackId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('Erro ao obter feedback:', error);
      return null;
    }
  }
}

// Instância global do DatabaseManager
const dbManager = new DatabaseManager();

// Exportar para uso global
window.dbManager = dbManager;