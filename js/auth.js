/**
 * js/auth.js — v8
 *
 * CORREÇÃO 1.4 — emailKey agora usa SHA-256 em vez de substituição de caracteres.
 * Antes: normalizedEmail.replace(/[^a-z0-9]/g, '_') causava colisões.
 * Ex: test@foo.com e test_foo_com geravam o mesmo emailKey "test_foo_com".
 *
 * A geração de hash no browser (WebCrypto) produz um identificador único
 * e sem colisões, mantendo compatibilidade com o servidor que também deve
 * migrar para o mesmo padrão.
 *
 * NOTA: Esta mudança implica que activations antigas com emailKey baseado
 * em sanitização NÃO serão encontradas pelo novo código. Para migração,
 * o servidor deve tentar ambos os formatos durante um período de transição,
 * ou regenerar os links de ativação pendentes.
 *
 * Todas as correções v7 mantidas.
 */

class AuthManager {
  constructor() {
    this.currentUser     = null;
    this.currentUserType = null;
    this.listeners       = [];
    this.isInitialized   = false;
    this.authStateUnsubscribe  = null;
    this.initializationPromise = null;
  }

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

  _generateActivationToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * CORREÇÃO 1.4 — Gera emailKey via SHA-256 (sem colisões).
   * Substitui o replace(/[^a-z0-9]/g, '_') que causava colisões.
   *
   * @param {string} normalizedEmail - email já em lowercase
   * @returns {Promise<string>} hex hash de 64 chars
   */
  async _emailToKey(normalizedEmail) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(normalizedEmail);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Cadastro de Personal Trainer ───────────────────────────────

  async signupPersonal(email, password, name) {
    try {
      if (!email || !password || !name) throw new Error('Todos os campos são obrigatórios');
      if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');

      const credential = await auth.createUserWithEmailAndPassword(email, password);
      const user       = credential.user;

      await db.collection('users').doc(user.uid).set({
        uid:          user.uid,
        name,
        email,
        userType:     'personal',
        status:       'active',
        students:     [],
        studentCount: 0,
        createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
      });

      this.currentUser     = user;
      this.currentUserType = 'personal';

      return { success: true, user, userType: 'personal' };
    } catch (error) {
      return { success: false, error: this._translateError(error) };
    }
  }

  // ── Gerenciamento de Alunos pelo Personal ──────────────────────

  async createStudentAccount(name, email) {
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

      const personalRef = db.collection('users').doc(personalUser.uid);
      const subRef      = db.collection('subscriptions').doc(personalUser.uid);
      let   studentRef;

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
        const currentStudents = typeof personalData.studentCount === 'number'
          ? personalData.studentCount
          : (personalData.students || []).length;

        if (currentStudents >= maxStudents) {
          throw new Error(
            `Limite de ${maxStudents} aluno(s) atingido para o plano atual. ` +
            'Faça upgrade para adicionar mais alunos.'
          );
        }

        studentRef = db.collection('users').doc();

        t.set(studentRef, {
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

        t.update(personalRef, {
          students:     firebase.firestore.FieldValue.arrayUnion(studentRef.id),
          studentCount: firebase.firestore.FieldValue.increment(1),
        });
      });

      const activationToken = this._generateActivationToken();
      const expiresAt       = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // CORREÇÃO 1.4: usar SHA-256 em vez de replace() para evitar colisões
      const emailKey = await this._emailToKey(normalizedEmail);

      await db.collection('pendingActivations').doc(emailKey).set({
        studentDocId:    studentRef.id,
        activationToken,
        createdBy:       personalUser.uid,
        status:          'pending',
        expiresAt:       firebase.firestore.Timestamp.fromDate(expiresAt),
        createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
      });

      const baseUrl = window.location.origin;
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

      let studentEmail = null;
      try {
        const studentDoc = await db.collection('users').doc(studentDocId).get();
        if (studentDoc.exists) {
          studentEmail = studentDoc.data().email;
        }
      } catch { /* melhor esforço */ }

      const batch = db.batch();

      batch.update(db.collection('users').doc(personalUser.uid), {
        students:     firebase.firestore.FieldValue.arrayRemove(studentDocId),
        studentCount: firebase.firestore.FieldValue.increment(-1),
      });

      batch.delete(db.collection('users').doc(studentDocId));

      await batch.commit();

      if (studentEmail) {
        try {
          // CORREÇÃO 1.4: usar mesmo hash para encontrar o documento
          const emailKey = await this._emailToKey(studentEmail.toLowerCase().trim());
          await db.collection('pendingActivations').doc(emailKey).delete();
        } catch { /* não crítico */ }
      }

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
      // CORREÇÃO 1.9: query inclui apenas dados necessários para verificação
      // A query ainda usa activationToken como chave primária de busca
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

  getCurrentUser()     { return this.currentUser; }
  getCurrentUserType() { return this.currentUserType; }
  isAuthenticated()    { return this.currentUser !== null; }
  isPersonal()         { return this.currentUserType === 'personal'; }
  isStudent()          { return this.currentUserType === 'student'; }

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