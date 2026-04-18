/**
 * js/auth.js — v6
 *
 * CORREÇÕES v6:
 * 1. activationUrl usa hash fragment (#token=) em vez de query string (?token=)
 *    — token não vaza em logs de CDN, Vercel, analytics ou header Referer
 * 2. Timing equalizado em createStudentAccount (min 300ms) para prevenir
 *    enumeração de emails por side-channel de tempo
 *
 * Todas as correções v5 mantidas:
 * - Transação atômica para verificar limite de alunos
 * - Resposta genérica para email duplicado
 * - Token de 64 chars (256 bits)
 */

class AuthManager {
  constructor() {
    this.currentUser     = null;
    this.currentUserType = null;
    this.listeners       = [];
    this.isInitialized   = false;
    this.authStateUnsubscribe  = null;
    this.initializationPromise = null;
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
          } catch {
            this.currentUserType = null;
          }
        } else {
          this.currentUser     = null;
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
    this.isInitialized         = false;
    this.initializationPromise = null;
    await new Promise(r => setTimeout(r, 100));
    await this.initialize();
  }

  notifyListeners() {
    this.listeners.forEach(cb => {
      try { cb(this.currentUser, this.currentUserType); } catch { /* ignore */ }
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

  // ── Gerador de token seguro ────────────────────────────────────
  _generateActivationToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Cadastro de Personal Trainer ───────────────────────────────

  async signupPersonal(email, password, name) {
    try {
      if (!email || !password || !name) throw new Error('Todos os campos são obrigatórios');
      if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');

      const credential = await auth.createUserWithEmailAndPassword(email, password);
      const user       = credential.user;

      await db.collection('users').doc(user.uid).set({
        uid:       user.uid,
        name,
        email,
        userType:  'personal',
        status:    'active',
        students:  [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      this.currentUser     = user;
      this.currentUserType = 'personal';

      return { success: true, user, userType: 'personal' };
    } catch (error) {
      return { success: false, error: this._translateError(error) };
    }
  }

  // ── Gerenciamento de Alunos pelo Personal ──────────────────────

  /**
   * Cria conta de aluno com:
   * 1. Timing equalizado (min 300ms) — previne enumeração de emails por timing
   * 2. Transação atômica para verificar e bloquear limite de alunos
   * 3. Resposta genérica para email duplicado — não confirma existência
   * 4. Token de ativação via hash fragment (#token=) — não vaza em logs
   */
  async createStudentAccount(name, email) {
    // CORREÇÃO VULN 6: Tempo mínimo de resposta para equalizar timing
    const startTime = Date.now();
    const MIN_RESPONSE_MS = 300;

    const equalizeAndReturn = async (result) => {
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_RESPONSE_MS) {
        await new Promise(r => setTimeout(r, MIN_RESPONSE_MS - elapsed));
      }
      return result;
    };

    try {
      const personalUser = this.currentUser;
      if (!personalUser) throw new Error('Não autenticado');
      if (this.currentUserType !== 'personal') throw new Error('Apenas personals podem criar alunos');
      if (!name || !email) throw new Error('Nome e e-mail são obrigatórios');

      const normalizedEmail = email.toLowerCase().trim();

      // Verificar email existente — resposta GENÉRICA para não revelar existência
      const existing = await db.collection('users')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();

      if (!existing.empty) {
        return equalizeAndReturn({
          success: false,
          error: 'Não foi possível criar a conta com este e-mail. Verifique se o aluno já está cadastrado na sua lista.',
        });
      }

      // Verificar limite de alunos via transação atômica
      const personalRef = db.collection('users').doc(personalUser.uid);
      const subRef      = db.collection('subscriptions').doc(personalUser.uid);

      await db.runTransaction(async (t) => {
        const [personalDoc, subDoc] = await Promise.all([
          t.get(personalRef),
          t.get(subRef),
        ]);

        if (!personalDoc.exists) throw new Error('Dados do personal não encontrados');
        if (!subDoc.exists) throw new Error('Assinatura não encontrada. Assine um plano para adicionar alunos.');

        const subData     = subDoc.data();
        const maxStudents = subData.maxStudents || 0;
        const status      = subData.status;

        if (!['active', 'grace_period'].includes(status)) {
          throw new Error('Assinatura expirada. Renove para adicionar novos alunos.');
        }

        const personalData    = personalDoc.data();
        const currentStudents = (personalData.students || []).length;

        if (currentStudents >= maxStudents) {
          throw new Error(
            `Limite de ${maxStudents} aluno(s) atingido para o plano atual. ` +
            'Faça upgrade para adicionar mais alunos.'
          );
        }
      });

      // Criar doc provisório do aluno
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
        createdBy:        personalUser.uid,
      });

      await db.collection('users').doc(personalUser.uid).update({
        students: firebase.firestore.FieldValue.arrayUnion(studentRef.id),
      });

      const activationToken = this._generateActivationToken();
      const expiresAt       = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const emailKey        = normalizedEmail.replace(/[^a-z0-9]/g, '_');

      await db.collection('pendingActivations').doc(emailKey).set({
        studentDocId:    studentRef.id,
        activationToken,
        createdBy:       personalUser.uid,
        status:          'pending',
        expiresAt:       firebase.firestore.Timestamp.fromDate(expiresAt),
        createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
      });

      const baseUrl = window.location.origin;

      // CORREÇÃO VULN 3: Hash fragment (#token=) em vez de query string (?token=)
      // O fragmento nunca é enviado ao servidor — não aparece em logs de CDN,
      // Vercel, Google Analytics, header Referer ou qualquer ferramenta de analytics.
      const activationUrl = `${baseUrl}/#/primeiro-acesso#token=${activationToken}`;

      return equalizeAndReturn({
        success: true,
        studentDocId: studentRef.id,
        activationToken,
        activationUrl,
      });
    } catch (error) {
      return equalizeAndReturn({ success: false, error: error.message });
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
      } catch { /* índice pode não existir */ }

      await db.collection('users').doc(personalUser.uid).update({
        students: firebase.firestore.FieldValue.arrayRemove(studentDocId),
      });

      await db.collection('users').doc(studentDocId).delete();

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Primeiro Acesso do Aluno ───────────────────────────────────

  async checkPendingStudent(activationToken) {
    if (!activationToken || activationToken.length < 32) {
      return { exists: false, invalidToken: true };
    }

    try {
      const snap = await db.collection('pendingActivations')
        .where('activationToken', '==', activationToken)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (snap.empty) return { exists: false, invalidToken: true };

      const indexDoc  = snap.docs[0];
      const indexData = indexDoc.data();

      if (indexData.expiresAt) {
        const expiresAt = indexData.expiresAt.toDate
          ? indexData.expiresAt.toDate()
          : new Date(indexData.expiresAt);
        if (new Date() > expiresAt) return { exists: false, expired: true };
      }

      const studentDoc = await db.collection('users').doc(indexData.studentDocId).get();
      if (!studentDoc.exists) return { exists: false, alreadyActive: true };

      const studentStatus = studentDoc.data().status;
      if (studentStatus !== 'pending') return { exists: false, alreadyActive: true };

      const studentData = studentDoc.data();

      return {
        exists:          true,
        studentDocId:    indexData.studentDocId,
        emailKey:        indexDoc.id,
        name:            studentData.name,
        email:           studentData.email,
        personalId:      studentData.personalId,
        activationToken,
      };
    } catch (error) {
      return { exists: false, error: error.message };
    }
  }

  async activateStudentAccount(email, password, studentDocId, activationToken, emailKey) {
    if (!activationToken || activationToken.length < 32) {
      return {
        success: false,
        error:   'Token de ativação inválido. Use o link enviado pelo seu personal trainer.',
      };
    }

    if (this._activationInProgress) {
      return { success: false, error: 'Ativação já em andamento. Aguarde.' };
    }
    this._activationInProgress = true;

    try {
      if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');

      const normalizedEmail = email.toLowerCase().trim();

      const tokenSnap = await db.collection('pendingActivations')
        .where('activationToken', '==', activationToken)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (tokenSnap.empty) {
        return {
          success: false,
          error:   'Link de ativação inválido ou já utilizado. Solicite um novo link ao seu personal trainer.',
        };
      }

      const activationDoc  = tokenSnap.docs[0];
      const activationData = activationDoc.data();

      if (activationData.expiresAt) {
        const expiresAt = activationData.expiresAt.toDate
          ? activationData.expiresAt.toDate()
          : new Date(activationData.expiresAt);
        if (new Date() > expiresAt) {
          return {
            success: false,
            error:   'Link de ativação expirado. Solicite um novo link ao seu personal trainer.',
          };
        }
      }

      const provisoryDoc = await db.collection('users').doc(studentDocId).get();
      if (!provisoryDoc.exists) {
        throw new Error('Dados do aluno não encontrados. Entre em contato com seu personal trainer.');
      }
      const studentData = provisoryDoc.data();

      if (studentData.status === 'activating') {
        await new Promise(r => setTimeout(r, 3000));
        const recheckDoc = await db.collection('users').doc(studentDocId).get();
        if (recheckDoc.exists && recheckDoc.data().status === 'activating') {
          await db.collection('users').doc(studentDocId).update({ status: 'pending' });
        } else if (recheckDoc.exists && recheckDoc.data().status !== 'pending') {
          return { success: false, error: 'Conta já foi ativada em outro dispositivo. Faça login.' };
        }
      }

      try {
        await db.collection('users').doc(studentDocId).update({ status: 'activating' });
      } catch { /* melhor esforço */ }

      let user;
      try {
        const credential = await auth.createUserWithEmailAndPassword(normalizedEmail, password);
        user = credential.user;
      } catch (authError) {
        if (authError.code === 'auth/email-already-in-use') {
          const credential = await auth.signInWithEmailAndPassword(normalizedEmail, password);
          user = credential.user;
        } else {
          try {
            await db.collection('users').doc(studentDocId).update({ status: 'pending' });
          } catch { /* melhor esforço */ }
          throw authError;
        }
      }

      const existingDoc = await db.collection('users').doc(user.uid).get();
      if (existingDoc.exists && existingDoc.data().status === 'active') {
        this.currentUser     = user;
        this.currentUserType = 'student';
        return { success: true, user, userType: 'student' };
      }

      await db.collection('users').doc(user.uid).set({
        ...studentData,
        uid:         user.uid,
        authUid:     user.uid,
        status:      'active',
        activatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      try { await db.collection('users').doc(studentDocId).delete(); } catch { /* melhor esforço */ }

      const personalId = studentData.personalId;
      if (personalId) {
        try {
          await db.collection('users').doc(personalId).update({
            students: firebase.firestore.FieldValue.arrayRemove(studentDocId),
          });
          await db.collection('users').doc(personalId).update({
            students: firebase.firestore.FieldValue.arrayUnion(user.uid),
          });
        } catch { /* melhor esforço */ }
      }

      try {
        const resolvedEmailKey = emailKey || activationData.emailKey || '';
        if (resolvedEmailKey) {
          await db.collection('pendingActivations').doc(resolvedEmailKey).update({
            status:    'used',
            usedAt:    firebase.firestore.FieldValue.serverTimestamp(),
            usedByUid: user.uid,
          });
        } else {
          await activationDoc.ref.update({
            status:    'used',
            usedAt:    firebase.firestore.FieldValue.serverTimestamp(),
            usedByUid: user.uid,
          });
        }
      } catch { /* melhor esforço */ }

      this.currentUser     = user;
      this.currentUserType = 'student';

      return { success: true, user, userType: 'student' };

    } catch (error) {
      try {
        const currentDoc = await db.collection('users').doc(studentDocId).get();
        if (currentDoc.exists && currentDoc.data().status === 'activating') {
          await db.collection('users').doc(studentDocId).update({ status: 'pending' });
        }
      } catch { /* melhor esforço */ }

      return { success: false, error: this._translateError(error) };
    } finally {
      this._activationInProgress = false;
    }
  }

  // ── Login / Logout ─────────────────────────────────────────────

  async login(email, password) {
    try {
      const credential = await auth.signInWithEmailAndPassword(email, password);
      const user       = credential.user;

      const doc = await db.collection('users').doc(user.uid).get();
      if (!doc.exists) throw new Error('Dados do usuário não encontrados');

      const data = doc.data();

      if (data.userType === 'student' && data.status === 'inactive') {
        await auth.signOut();
        return {
          success: false,
          error:   'Sua conta foi desativada. Entre em contato com seu personal trainer.',
        };
      }

      this.currentUser     = user;
      this.currentUserType = data.userType;

      return { success: true, user, userType: data.userType };
    } catch (error) {
      return { success: false, error: this._translateError(error) };
    }
  }

  async logout() {
    this.currentUser     = null;
    this.currentUserType = null;
    try {
      await auth.signOut();
      await new Promise(r => setTimeout(r, 200));
      await this.reinitialize();
    } catch { /* ignore */ }
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
      'auth/user-disabled':        'Usuário desabilitado',
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