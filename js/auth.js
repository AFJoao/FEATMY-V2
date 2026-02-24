/**
 * Módulo de Autenticação — Refatorado
 *
 * FLUXO:
 * - Personal cria conta do aluno (nome + email) → status: 'pending'
 *   → cria também doc em pendingActivations/{emailKey} como índice público
 * - Aluno acessa /primeiro-acesso → checkPendingStudent faz get no índice público
 *   → sem query na coleção users (evita bloqueio das regras Firestore)
 * - Aluno define senha → activateStudentAccount migra doc, deleta índice
 */

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.currentUserType = null;
    this.listeners = [];
    this.isInitialized = false;
    this.authStateUnsubscribe = null;
    this.initializationPromise = null;
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

  /**
   * Personal cria pré-conta de aluno (sem senha).
   * Cria doc em users/ com status 'pending' e índice em pendingActivations/.
   */
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

      // Índice público para o fluxo de primeiro acesso.
      // ID = email sanitizado. Permite get sem auth pela página de primeiro acesso.
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

      // Buscar email do aluno para limpar o índice
      try {
        const studentDoc = await db.collection('users').doc(studentDocId).get();
        if (studentDoc.exists) {
          const emailKey = studentDoc.data().email.replace(/[^a-z0-9]/g, '_');
          await db.collection('pendingActivations').doc(emailKey).delete();
        }
      } catch (e) { /* índice pode não existir, ignorar */ }

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

  /**
   * Verifica se um e-mail tem conta pendente de ativação.
   *
   * USA GET DIRETO no índice pendingActivations/{emailKey} — não faz query.
   * Queries na coleção users são bloqueadas pelas regras para usuários não autenticados.
   *
   * Retorna:
   *   { exists: true,  studentDocId, name, personalId } → pendente, pode ativar
   *   { exists: false, alreadyActive: true }            → já ativada, fazer login
   *   { exists: false, noIndex: true }                  → aluno sem índice (criado antes desta versão)
   *   { exists: false }                                 → e-mail não encontrado
   */
  async checkPendingStudent(email) {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const emailKey = normalizedEmail.replace(/[^a-z0-9]/g, '_');

      // Get direto no índice público — permitido pelas regras sem autenticação
      const indexDoc = await db.collection('pendingActivations').doc(emailKey).get();

      if (!indexDoc.exists) {
        // Índice não existe. Pode ser:
        // (a) e-mail nunca cadastrado
        // (b) aluno já ativou e o índice foi deletado → alreadyActive
        // (c) aluno criado antes desta versão → noIndex
        // Não conseguimos distinguir (a) de (c) sem auth. Retornamos noIndex
        // para que a página informe o personal.
        return { exists: false, noIndex: true };
      }

      const indexData = indexDoc.data();

      if (indexData.status !== 'pending') {
        return { exists: false, alreadyActive: true };
      }

      // Get direto no doc do aluno pelo ID do índice
      // Permitido pelas regras: get público de doc com status=pending
      const studentDoc = await db.collection('users').doc(indexData.studentDocId).get();

      if (!studentDoc.exists || studentDoc.data().status !== 'pending') {
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
   * Aluno define senha e ativa a conta.
   *
   * Idempotente — pode ser chamado N vezes com segurança:
   * 1. Lê doc provisório (get, sem update)
   * 2. Cria Auth ou faz login se já existe
   * 3. Verifica se migração já concluída
   * 4. Cria doc definitivo users/{uid}
   * 5. Deleta doc provisório
   * 6. Atualiza lista do personal
   * 7. Deleta índice pendingActivations
   */
  async activateStudentAccount(email, password, studentDocId) {
    try {
      if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');

      const normalizedEmail = email.toLowerCase().trim();

      // ── 1. Ler doc provisório (apenas get, sem update) ─────────────
      const provisoryDoc = await db.collection('users').doc(studentDocId).get();
      if (!provisoryDoc.exists) {
        throw new Error('Dados do aluno não encontrados. Entre em contato com seu personal trainer.');
      }
      const studentData = provisoryDoc.data();

      // ── 2. Criar Auth ou recuperar se já existe ────────────────────
      let user;
      try {
        const credential = await auth.createUserWithEmailAndPassword(normalizedEmail, password);
        user = credential.user;
      } catch (authError) {
        if (authError.code === 'auth/email-already-in-use') {
          // Tentativa anterior criou o Auth mas não finalizou o Firestore.
          const credential = await auth.signInWithEmailAndPassword(normalizedEmail, password);
          user = credential.user;
        } else {
          throw authError;
        }
      }

      // ── 3. Verificar se migração já foi concluída ──────────────────
      const existingDoc = await db.collection('users').doc(user.uid).get();
      if (existingDoc.exists && existingDoc.data().status === 'active') {
        this.currentUser     = user;
        this.currentUserType = 'student';
        return { success: true, user, userType: 'student' };
      }

      // ── 4. Criar doc definitivo users/{uid} ────────────────────────
      await db.collection('users').doc(user.uid).set({
        ...studentData,
        uid:         user.uid,
        authUid:     user.uid,
        status:      'active',
        activatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // ── 5. Deletar doc provisório ──────────────────────────────────
      try {
        await db.collection('users').doc(studentDocId).delete();
      } catch (e) {
        console.warn('Aviso: não foi possível deletar doc provisório:', e.message);
      }

      // ── 6. Atualizar lista do personal ─────────────────────────────
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
          console.warn('Aviso: não foi possível atualizar lista do personal:', e.message);
        }
      }

      // ── 7. Deletar índice pendingActivations ───────────────────────
      try {
        const emailKey = normalizedEmail.replace(/[^a-z0-9]/g, '_');
        await db.collection('pendingActivations').doc(emailKey).delete();
      } catch (e) {
        console.warn('Aviso: não foi possível remover índice pendingActivations:', e.message);
      }

      this.currentUser     = user;
      this.currentUserType = 'student';

      return { success: true, user, userType: 'student' };
    } catch (error) {
      return { success: false, error: this._translateError(error) };
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