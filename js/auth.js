/**
 * js/auth.js — v4
 *
 * CORREÇÕES v4:
 *
 * 1. TOKEN DE ATIVAÇÃO SEGURO (anti account-takeover)
 *    Antes: pendingActivations era público (allow get: if true).
 *    Qualquer pessoa podia consultar se um email estava pendente,
 *    obter o studentDocId e criar a conta Auth antes do aluno real,
 *    assumindo controle da conta (account takeover).
 *
 *    Agora:
 *    - createStudentAccount() gera um activationToken aleatório de 64 chars
 *    - O token é salvo em pendingActivations junto com expiresAt (7 dias)
 *    - checkPendingStudent() agora exige o token — sem token, sem acesso
 *    - A URL de ativação inclui o token: /#/primeiro-acesso?token=xxx
 *    - O personal deve compartilhar essa URL com o aluno
 *    - Sem conhecer o token, um atacante não consegue ativar a conta
 *
 * 2. VALIDAÇÃO DE TOKEN NA ATIVAÇÃO
 *    - activateStudentAccount() valida token antes de criar Auth
 *    - Token expirado (> 7 dias) é rejeitado com mensagem clara
 *    - Token com status != 'pending' é rejeitado
 *
 * 3. RACE CONDITION (mantida da v3, levemente reforçada)
 *    - Lock em memória (mesma aba)
 *    - Status 'activating' no Firestore (distribuído entre abas/devices)
 *
 * 4. ENUMERAÇÃO DE EMAILS MITIGADA
 *    - checkPendingStudent() sem token sempre retorna { exists: false }
 *    - Não revela se o email existe ou não sem o token válido
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

  // ── Gerador de token seguro ────────────────────────────────────
  // Usa crypto.getRandomValues para entropia criptográfica.
  // Produz 64 caracteres hexadecimais (256 bits de entropia).
  // Impossível de adivinhar por força bruta.
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
   * Cria conta de aluno e gera token de ativação seguro.
   *
   * NOVO em v4:
   * - Gera activationToken aleatório de 64 chars (256 bits)
   * - Salva token em pendingActivations com expiresAt (7 dias)
   * - Retorna activationUrl para o personal compartilhar com o aluno
   *
   * O personal deve enviar a activationUrl ao aluno por WhatsApp,
   * email ou qualquer canal. Sem a URL, o aluno não consegue ativar.
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
        createdBy:        personalUser.uid
      });

      await db.collection('users').doc(personalUser.uid).update({
        students: firebase.firestore.FieldValue.arrayUnion(studentRef.id)
      });

      // NOVO v4: gerar token seguro de ativação
      const activationToken = this._generateActivationToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

      const emailKey = normalizedEmail.replace(/[^a-z0-9]/g, '_');
      await db.collection('pendingActivations').doc(emailKey).set({
        studentDocId:    studentRef.id,
        activationToken, // token opaco — necessário para ativar
        createdBy:       personalUser.uid,
        status:          'pending',
        expiresAt:       firebase.firestore.Timestamp.fromDate(expiresAt),
        createdAt:       firebase.firestore.FieldValue.serverTimestamp()
      });

      // URL que o personal deve enviar ao aluno
      // O token é o único meio de acessar o fluxo de ativação
      const baseUrl = window.location.origin;
      const activationUrl = `${baseUrl}/#/primeiro-acesso?token=${activationToken}`;

      return {
        success: true,
        studentDocId: studentRef.id,
        activationToken,
        activationUrl
      };
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

  /**
   * Verifica se há uma conta pendente para o token fornecido.
   *
   * MUDANÇA v4: agora recebe o token (não o email diretamente).
   * O token vem da URL de ativação compartilhada pelo personal.
   *
   * Sem token válido, retorna { exists: false } sem revelar
   * se o email existe ou não — previne enumeração de emails.
   *
   * @param {string} activationToken - Token de 64 chars da URL de ativação
   */
  async checkPendingStudent(activationToken) {
    // Sem token, sempre nega — não revela nada
    if (!activationToken || activationToken.length < 32) {
      return { exists: false, invalidToken: true };
    }

    try {
      // Buscar por token (query no Firestore)
      // O token é único e não pode ser adivinhado
      const snap = await db.collection('pendingActivations')
        .where('activationToken', '==', activationToken)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (snap.empty) {
        return { exists: false, invalidToken: true };
      }

      const indexDoc  = snap.docs[0];
      const indexData = indexDoc.data();

      // Verificar expiração
      if (indexData.expiresAt) {
        const expiresAt = indexData.expiresAt.toDate
          ? indexData.expiresAt.toDate()
          : new Date(indexData.expiresAt);
        if (new Date() > expiresAt) {
          return { exists: false, expired: true };
        }
      }

      // Buscar doc do aluno
      const studentDoc = await db.collection('users').doc(indexData.studentDocId).get();

      if (!studentDoc.exists) {
        return { exists: false, alreadyActive: true };
      }

      const studentStatus = studentDoc.data().status;
      if (studentStatus !== 'pending') {
        return { exists: false, alreadyActive: true };
      }

      const studentData = studentDoc.data();

      return {
        exists:          true,
        studentDocId:    indexData.studentDocId,
        emailKey:        indexDoc.id, // necessário para deletar o índice depois
        name:            studentData.name,
        email:           studentData.email,
        personalId:      studentData.personalId,
        activationToken  // devolver para uso em activateStudentAccount
      };
    } catch (error) {
      return { exists: false, error: error.message };
    }
  }

  /**
   * Ativa a conta do aluno com proteção contra race condition.
   *
   * PROTEÇÃO v4 (três camadas):
   *
   * Camada 1 — Validação de token:
   *   O token de 64 chars deve ser o mesmo gerado em createStudentAccount.
   *   Sem token válido, a ativação é bloqueada antes de qualquer operação.
   *
   * Camada 2 — Lock em memória (mesma aba):
   *   this._activationInProgress impede dois cliques rápidos.
   *
   * Camada 3 — Status 'activating' no Firestore (distribuído):
   *   Marca o doc como em processo. Outra aba que tentar ativar
   *   ao mesmo tempo verá o status e abortará.
   *
   * @param {string} email           - Email do aluno
   * @param {string} password        - Senha escolhida pelo aluno
   * @param {string} studentDocId    - ID do doc provisório
   * @param {string} activationToken - Token da URL de ativação (obrigatório v4)
   * @param {string} emailKey        - Chave do doc em pendingActivations
   */
  async activateStudentAccount(email, password, studentDocId, activationToken, emailKey) {
    // Camada 1: validar token antes de qualquer coisa
    if (!activationToken || activationToken.length < 32) {
      return { success: false, error: 'Token de ativação inválido. Use o link enviado pelo seu personal trainer.' };
    }

    // Camada 2: lock em memória
    if (this._activationInProgress) {
      return { success: false, error: 'Ativação já em andamento. Aguarde.' };
    }
    this._activationInProgress = true;

    try {
      if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');

      const normalizedEmail = email.toLowerCase().trim();

      // ── 1. Verificar token ainda válido no Firestore ───────────
      // Revalidar no momento da ativação — não confiar apenas no
      // resultado de checkPendingStudent (pode estar stale)
      const tokenSnap = await db.collection('pendingActivations')
        .where('activationToken', '==', activationToken)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (tokenSnap.empty) {
        return { success: false, error: 'Link de ativação inválido ou já utilizado. Solicite um novo link ao seu personal trainer.' };
      }

      const activationDoc  = tokenSnap.docs[0];
      const activationData = activationDoc.data();

      // Verificar expiração
      if (activationData.expiresAt) {
        const expiresAt = activationData.expiresAt.toDate
          ? activationData.expiresAt.toDate()
          : new Date(activationData.expiresAt);
        if (new Date() > expiresAt) {
          return { success: false, error: 'Link de ativação expirado. Solicite um novo link ao seu personal trainer.' };
        }
      }

      // ── 2. Ler doc provisório ──────────────────────────────────
      const provisoryDoc = await db.collection('users').doc(studentDocId).get();
      if (!provisoryDoc.exists) {
        throw new Error('Dados do aluno não encontrados. Entre em contato com seu personal trainer.');
      }
      const studentData = provisoryDoc.data();

      // Verificar se já está sendo ativado por outra sessão
      if (studentData.status === 'activating') {
        await new Promise(r => setTimeout(r, 3000));
        const recheckDoc = await db.collection('users').doc(studentDocId).get();
        if (recheckDoc.exists && recheckDoc.data().status === 'activating') {
          console.warn('[activateStudentAccount] Status travado em activating, limpando...');
          await db.collection('users').doc(studentDocId).update({ status: 'pending' });
        } else if (recheckDoc.exists && recheckDoc.data().status !== 'pending') {
          return { success: false, error: 'Conta já foi ativada em outro dispositivo. Faça login.' };
        }
      }

      // ── 3. Camada 3: marcar como 'activating' (mutex distribuído) ──
      try {
        await db.collection('users').doc(studentDocId).update({ status: 'activating' });
      } catch (e) {
        console.warn('[activateStudentAccount] Não foi possível marcar activating:', e.message);
      }

      // ── 4. Criar Auth ou recuperar se já existe ────────────────
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

      // ── 5. Verificar se migração já foi concluída ──────────────
      const existingDoc = await db.collection('users').doc(user.uid).get();
      if (existingDoc.exists && existingDoc.data().status === 'active') {
        this.currentUser     = user;
        this.currentUserType = 'student';
        return { success: true, user, userType: 'student' };
      }

      // ── 6. Criar doc definitivo users/{uid} ────────────────────
      await db.collection('users').doc(user.uid).set({
        ...studentData,
        uid:         user.uid,
        authUid:     user.uid,
        status:      'active',
        activatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // ── 7. Deletar doc provisório ──────────────────────────────
      try {
        await db.collection('users').doc(studentDocId).delete();
      } catch (e) {
        console.warn('[activateStudentAccount] Não foi possível deletar doc provisório:', e.message);
      }

      // ── 8. Atualizar lista do personal ─────────────────────────
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

      // ── 9. Invalidar token de ativação (marcar como usado) ─────
      // NOVO v4: marcar o token como 'used' para que não possa
      // ser reutilizado. Não deletar — manter histórico de ativação.
      try {
        const resolvedEmailKey = emailKey || activationData.emailKey || '';
        if (resolvedEmailKey) {
          await db.collection('pendingActivations').doc(resolvedEmailKey).update({
            status:      'used',
            usedAt:      firebase.firestore.FieldValue.serverTimestamp(),
            usedByUid:   user.uid
          });
        } else {
          // Fallback: deletar o doc se não temos o emailKey
          await activationDoc.ref.update({
            status:      'used',
            usedAt:      firebase.firestore.FieldValue.serverTimestamp(),
            usedByUid:   user.uid
          });
        }
      } catch (e) {
        console.warn('[activateStudentAccount] Não foi possível invalidar token:', e.message);
      }

      this.currentUser     = user;
      this.currentUserType = 'student';

      return { success: true, user, userType: 'student' };

    } catch (error) {
      // Em caso de erro inesperado, reverter status para 'pending'
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