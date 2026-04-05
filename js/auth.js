/**
 * Módulo de Autenticação — v3
 *
 * CORREÇÕES v3:
 * - Race condition em activateStudentAccount resolvida via lock em memória
 *   + status 'activating' no Firestore como mutex distribuído.
 *   Dois cliques rápidos ou duas abas simultâneas não criam duplicatas.
 */

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.currentUserType = null;
    this.listeners = [];
    this.isInitialized = false;
    this.authStateUnsubscribe = null;
    this.initializationPromise = null;

    // Lock em memória para evitar dupla ativação na mesma aba
    this._activationInProgress = false;
  }

  // ── Inicialização ──────────────────────────────────────────────

  initialize() {
    if (this.initializationPromise) return this.initializationPromise;
    if (this.isInitialized) return Promise.resolve();

    this.initializationPromise = new Promise((resolve) => {
      let resolved = false;

      this.authStateUnsubscribe = auth.onAuthStateChanged(async (user) => {
        if (user) {
          this.currentUser = user;
          try {
            const doc = await db.collection('users').doc(user.uid).get();
            this.currentUserType = doc.exists ? doc.data().userType : null;
          } catch (e) {
            this.currentUserType = null;
          }
        } else {
          this.currentUser = null;
          this.currentUserType = null;
        }

        this.notifyListeners();

        if (!resolved) {
          resolved = true;
          this.isInitialized = true;
          resolve();
        }
      });
    });

    return this.initializationPromise;
  }

  async reinitialize() {
    this.isInitialized = false;
    this.initializationPromise = null;
    await new Promise(r => setTimeout(r, 100));
    await this.initialize();
  }

  notifyListeners() {
    this.listeners.forEach(cb => {
      try { cb(this.currentUser, this.currentUserType); } catch (e) { /* ignore */ }
    });
  }

  onAuthStateChanged(callback) {
    this.listeners.push(callback);
    if (this.isInitialized) callback(this.currentUser, this.currentUserType);
  }

  cleanup() {
    if (this.authStateUnsubscribe) this.authStateUnsubscribe();
    this.listeners = [];
  }

  // ── Cadastro de Personal Trainer ───────────────────────────────

  async signupPersonal(email, password, name) {
    try {
      if (!email || !password || !name) throw new Error('Todos os campos são obrigatórios');
      if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');

      const credential = await auth.createUserWithEmailAndPassword(email, password);
      const user = credential.user;

      await db.collection('users').doc(user.uid).set({
        uid: user.uid,
        name,
        email,
        userType: 'personal',
        status: 'active',
        students: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      this.currentUser = user;
      this.currentUserType = 'personal';

      return { success: true, user, userType: 'personal' };
    } catch (error) {
      return { success: false, error: this._translateError(error) };
    }
  }

  // ── Gerenciamento de Alunos pelo Personal ──────────────────────

  async createStudentAccount(name, email) {
    try {
      const personalUser = this.currentUser;
      if (!personalUser) throw new Error('Não autenticado');
      if (this.currentUserType !== 'personal') throw new Error('Apenas personals podem criar alunos');
      if (!name || !email) throw new Error('Nome e e-mail são obrigatórios');

      const normalizedEmail = email.toLowerCase().trim();

      const existing = await db.collection('users')
        .where('email', '==', normalizedEmail)
        .get();
      if (!existing.empty) throw new Error('Este e-mail já está cadastrado');

      const studentRef = db.collection('users').doc();

      await studentRef.set({
        uid:              studentRef.id,
        name:             name.trim(),
        email:            normalizedEmail,
        userType:         'student',
        status:           'pending',
        personalId:       personalUser.uid,
        authUid:          null,
        assignedWorkouts: [],
        createdAt:        firebase.firestore.FieldValue.serverTimestamp(),
        createdBy:        personalUser.uid
      });

      await db.collection('users').doc(personalUser.uid).update({
        students: firebase.firestore.FieldValue.arrayUnion(studentRef.id)
      });

      const emailKey = normalizedEmail.replace(/[^a-z0-9]/g, '_');
      await db.collection('pendingActivations').doc(emailKey).set({
        studentDocId: studentRef.id,
        status:       'pending',
        createdAt:    firebase.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, studentDocId: studentRef.id };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deactivateStudent(studentDocId) {
    try {
      await db.collection('users').doc(studentDocId).update({ status: 'inactive' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async reactivateStudent(studentDocId) {
    try {
      await db.collection('users').doc(studentDocId).update({ status: 'active' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteStudent(studentDocId) {
    try {
      const personalUser = this.currentUser;
      if (!personalUser) throw new Error('Não autenticado');

      try {
        const studentDoc = await db.collection('users').doc(studentDocId).get();
        if (studentDoc.exists) {
          const emailKey = studentDoc.data().email.replace(/[^a-z0-9]/g, '_');
          await db.collection('pendingActivations').doc(emailKey).delete();
        }
      } catch (e) { /* índice pode não existir */ }

      await db.collection('users').doc(personalUser.uid).update({
        students: firebase.firestore.FieldValue.arrayRemove(studentDocId)
      });

      await db.collection('users').doc(studentDocId).delete();

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Primeiro Acesso do Aluno ───────────────────────────────────

  async checkPendingStudent(email) {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const emailKey = normalizedEmail.replace(/[^a-z0-9]/g, '_');

      const indexDoc = await db.collection('pendingActivations').doc(emailKey).get();

      if (!indexDoc.exists) {
        return { exists: false, noIndex: true };
      }

      const indexData = indexDoc.data();

      if (indexData.status !== 'pending') {
        return { exists: false, alreadyActive: true };
      }

      const studentDoc = await db.collection('users').doc(indexData.studentDocId).get();

      if (!studentDoc.exists) {
        return { exists: false, alreadyActive: true };
      }

      // Status 'activating' significa que outra aba/sessão já está no meio da ativação.
      // Tratamos como alreadyActive para evitar conflito.
      const studentStatus = studentDoc.data().status;
      if (studentStatus !== 'pending') {
        return { exists: false, alreadyActive: true };
      }

      const studentData = studentDoc.data();

      return {
        exists:       true,
        studentDocId: indexData.studentDocId,
        name:         studentData.name,
        personalId:   studentData.personalId
      };
    } catch (error) {
      return { exists: false, error: error.message };
    }
  }

  /**
   * Ativa a conta do aluno com proteção contra race condition.
   *
   * PROTEÇÃO v3 (duas camadas):
   *
   * Camada 1 — Lock em memória (mesma aba):
   *   this._activationInProgress impede que dois cliques rápidos
   *   no botão disparem duas execuções simultâneas na mesma aba.
   *
   * Camada 2 — Status 'activating' no Firestore (distribuído):
   *   Antes de criar o usuário no Auth, marcamos o doc provisório
   *   como 'activating'. Se outra aba ou dispositivo tentar ativar
   *   ao mesmo tempo, checkPendingStudent retornará alreadyActive.
   *   Ao final (sucesso ou erro), revertemos para 'pending' se algo
   *   falhar, para não deixar o aluno travado.
   *
   * Idempotência:
   *   Se o Auth foi criado mas o Firestore não foi atualizado (falha
   *   de rede), a próxima tentativa detecta o doc existente via
   *   existingDoc e conclui a migração sem recriar o Auth.
   */
  async activateStudentAccount(email, password, studentDocId) {
    // Camada 1: lock em memória
    if (this._activationInProgress) {
      return { success: false, error: 'Ativação já em andamento. Aguarde.' };
    }
    this._activationInProgress = true;

    try {
      if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');

      const normalizedEmail = email.toLowerCase().trim();

      // ── 1. Ler doc provisório ──────────────────────────────────
      const provisoryDoc = await db.collection('users').doc(studentDocId).get();
      if (!provisoryDoc.exists) {
        throw new Error('Dados do aluno não encontrados. Entre em contato com seu personal trainer.');
      }
      const studentData = provisoryDoc.data();

      // Se já está ativating por outra sessão, aguardar e verificar resultado
      if (studentData.status === 'activating') {
        // Pode ser uma tentativa anterior que falhou sem limpar o status.
        // Aguardamos 3s e verificamos se virou 'active' (sucesso de outra aba)
        // ou voltou para 'pending' (falha de outra aba — podemos tentar).
        await new Promise(r => setTimeout(r, 3000));
        const recheckDoc = await db.collection('users').doc(studentDocId).get();
        if (recheckDoc.exists && recheckDoc.data().status === 'activating') {
          // Ainda travado — limpar e continuar (a outra sessão provavelmente falhou)
          console.warn('[activateStudentAccount] Status travado em activating, limpando...');
          await db.collection('users').doc(studentDocId).update({ status: 'pending' });
        } else if (recheckDoc.exists && recheckDoc.data().status !== 'pending') {
          return { success: false, error: 'Conta já foi ativada em outro dispositivo. Faça login.' };
        }
      }

      // ── 2. Camada 2: marcar como 'activating' (mutex distribuído) ──
      try {
        await db.collection('users').doc(studentDocId).update({ status: 'activating' });
      } catch (e) {
        // Pode falhar por regras se o doc já não existe — ignorar
        console.warn('[activateStudentAccount] Não foi possível marcar activating:', e.message);
      }

      // ── 3. Criar Auth ou recuperar se já existe ────────────────
      let user;
      try {
        const credential = await auth.createUserWithEmailAndPassword(normalizedEmail, password);
        user = credential.user;
      } catch (authError) {
        if (authError.code === 'auth/email-already-in-use') {
          // Tentativa anterior criou o Auth mas não finalizou o Firestore
          const credential = await auth.signInWithEmailAndPassword(normalizedEmail, password);
          user = credential.user;
        } else {
          // Auth falhou — reverter status para 'pending'
          try {
            await db.collection('users').doc(studentDocId).update({ status: 'pending' });
          } catch (e) { /* melhor esforço */ }
          throw authError;
        }
      }

      // ── 4. Verificar se migração já foi concluída ──────────────
      const existingDoc = await db.collection('users').doc(user.uid).get();
      if (existingDoc.exists && existingDoc.data().status === 'active') {
        this.currentUser     = user;
        this.currentUserType = 'student';
        return { success: true, user, userType: 'student' };
      }

      // ── 5. Criar doc definitivo users/{uid} ────────────────────
      await db.collection('users').doc(user.uid).set({
        ...studentData,
        uid:         user.uid,
        authUid:     user.uid,
        status:      'active',
        activatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // ── 6. Deletar doc provisório ──────────────────────────────
      try {
        await db.collection('users').doc(studentDocId).delete();
      } catch (e) {
        console.warn('[activateStudentAccount] Não foi possível deletar doc provisório:', e.message);
      }

      // ── 7. Atualizar lista do personal ─────────────────────────
      const personalId = studentData.personalId;
      if (personalId) {
        try {
          await db.collection('users').doc(personalId).update({
            students: firebase.firestore.FieldValue.arrayRemove(studentDocId)
          });
          await db.collection('users').doc(personalId).update({
            students: firebase.firestore.FieldValue.arrayUnion(user.uid)
          });
        } catch (e) {
          console.warn('[activateStudentAccount] Não foi possível atualizar lista do personal:', e.message);
        }
      }

      // ── 8. Deletar índice pendingActivations ───────────────────
      try {
        const emailKey = normalizedEmail.replace(/[^a-z0-9]/g, '_');
        await db.collection('pendingActivations').doc(emailKey).delete();
      } catch (e) {
        console.warn('[activateStudentAccount] Não foi possível remover índice:', e.message);
      }

      this.currentUser     = user;
      this.currentUserType = 'student';

      return { success: true, user, userType: 'student' };

    } catch (error) {
      // Em caso de erro inesperado, tentar reverter status para 'pending'
      // para não deixar o aluno travado
      try {
        const currentDoc = await db.collection('users').doc(studentDocId).get();
        if (currentDoc.exists && currentDoc.data().status === 'activating') {
          await db.collection('users').doc(studentDocId).update({ status: 'pending' });
        }
      } catch (e) { /* melhor esforço */ }

      return { success: false, error: this._translateError(error) };
    } finally {
      // Sempre liberar o lock em memória
      this._activationInProgress = false;
    }
  }

  // ── Login / Logout ─────────────────────────────────────────────

  async login(email, password) {
    try {
      const credential = await auth.signInWithEmailAndPassword(email, password);
      const user = credential.user;

      const doc = await db.collection('users').doc(user.uid).get();
      if (!doc.exists) throw new Error('Dados do usuário não encontrados');

      const data = doc.data();

      if (data.userType === 'student' && data.status === 'inactive') {
        await auth.signOut();
        return { success: false, error: 'Sua conta foi desativada. Entre em contato com seu personal trainer.' };
      }

      this.currentUser = user;
      this.currentUserType = data.userType;

      return { success: true, user, userType: data.userType };
    } catch (error) {
      return { success: false, error: this._translateError(error) };
    }
  }

  async logout() {
    this.currentUser = null;
    this.currentUserType = null;
    try {
      await auth.signOut();
      await new Promise(r => setTimeout(r, 200));
      await this.reinitialize();
    } catch (e) { /* ignore */ }
    return { success: true };
  }

  // ── Getters ────────────────────────────────────────────────────

  getCurrentUser()     { return this.currentUser; }
  getCurrentUserType() { return this.currentUserType; }
  isAuthenticated()    { return this.currentUser !== null; }
  isPersonal()         { return this.currentUserType === 'personal'; }
  isStudent()          { return this.currentUserType === 'student'; }

  // ── Helpers ────────────────────────────────────────────────────

  _translateError(error) {
    const map = {
      'auth/email-already-in-use': 'Este e-mail já está cadastrado',
      'auth/invalid-email':        'E-mail inválido',
      'auth/weak-password':        'Senha muito fraca',
      'auth/user-not-found':       'Usuário não encontrado',
      'auth/wrong-password':       'Senha incorreta',
      'auth/invalid-credential':   'E-mail ou senha incorretos',
      'auth/too-many-requests':    'Muitas tentativas. Tente novamente mais tarde',
      'auth/user-disabled':        'Usuário desabilitado'
    };
    return map[error.code] || error.message || 'Erro desconhecido';
  }
}

const authManager = new AuthManager();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => authManager.initialize());
} else {
  authManager.initialize();
}

window.authManager = authManager;