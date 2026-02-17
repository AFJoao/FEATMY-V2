# Guia de Início Rápido - Personal Trainer App

## 📋 Resumo

Este é um guia passo-a-passo para colocar a aplicação funcionando em menos de 30 minutos.

---

## ⚡ 5 Passos Principais

### 1️⃣ Criar Projeto no Firebase (5 min)

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Clique em "Adicionar projeto"
3. Digite o nome: `personal-trainer-app`
4. Clique em "Criar projeto"

### 2️⃣ Obter Credenciais (5 min)

1. No Firebase Console, clique em ⚙️ (Configurações)
2. Vá para "Geral"
3. Desça até "Seus aplicativos"
4. Clique em "Adicionar aplicativo" → "Web"
5. Preencha o apelido: `personal-trainer-web`
6. Copie o objeto de configuração que aparece

### 3️⃣ Configurar o Arquivo config.js (3 min)

1. Abra `js/config.js` no seu editor
2. Substitua os valores:

```javascript
const firebaseConfig = {
  apiKey: "COPIE DAQUI",
  authDomain: "COPIE DAQUI",
  projectId: "COPIE DAQUI",
  storageBucket: "COPIE DAQUI",
  messagingSenderId: "COPIE DAQUI",
  appId: "COPIE DAQUI"
};
```

3. Salve o arquivo

### 4️⃣ Habilitar Autenticação no Firebase (3 min)

1. No Firebase Console, vá para "Autenticação"
2. Clique em "Começar"
3. Clique em "Email/Senha"
4. Habilite "Email/Senha"
5. Clique em "Salvar"

### 5️⃣ Criar Firestore Database (3 min)

1. No Firebase Console, vá para "Firestore Database"
2. Clique em "Criar banco de dados"
3. Selecione "Iniciar no modo de teste"
4. Selecione a localização mais próxima
5. Clique em "Criar"

---

## 🧪 Testar Localmente (5 min)

### Com Python 3:
```bash
cd personal-trainer-app
python -m http.server 8000
```

### Com Node.js:
```bash
npm install -g http-server
cd personal-trainer-app
http-server -p 8000
```

### Abra no navegador:
```
http://localhost:8000
```

---

## ✅ Teste Rápido (5 min)

1. Clique em "Cadastre-se aqui"
2. Preencha:
   - Nome: `Seu Nome`
   - Email: `seu@email.com`
   - Senha: `senha123`
   - Tipo: `Personal Trainer`
3. Clique em "Cadastrar"
4. Você deve ver o dashboard do Personal

---

## 🚀 Deploy (Escolha Uma Opção)

### Opção A: Vercel (Recomendado)

```bash
# 1. Criar repositório GitHub
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/seu-usuario/seu-repo.git
git push -u origin main

# 2. Conectar no Vercel
# Acesse vercel.com e importe seu repositório
```

### Opção B: Firebase Hosting

```bash
# 1. Instalar Firebase CLI
npm install -g firebase-tools

# 2. Login
firebase login

# 3. Inicializar
firebase init hosting

# 4. Deploy
firebase deploy
```

---

## 🔐 Configurar Segurança (Importante!)

1. No Firebase Console, vá para "Firestore Database"
2. Clique em "Regras"
3. Substitua tudo pelo conteúdo do arquivo `firestore.rules`
4. Clique em "Publicar"

---

## 📚 Próximos Passos

- Leia `MANUAL_COMPLETO.md` para documentação detalhada
- Customize os estilos em `css/style.css`
- Adicione mais funcionalidades conforme necessário

---

## ❓ Problemas Comuns

### "Firebase não está definido"
→ Verifique se os scripts do Firebase estão carregando em `index.html`

### "Erro de autenticação"
→ Verifique se Firebase Authentication está habilitado

### "Dados não aparecem"
→ Verifique se Firestore foi criado e as regras de segurança estão corretas

### "Página em branco"
→ Abra o console (F12) e procure por erros

---

## 🎉 Pronto!

Sua aplicação está funcionando! Agora você pode:

1. Criar exercícios como Personal
2. Criar treinos e associar a alunos
3. Visualizar treinos como Aluno
4. Compartilhar a URL com seus alunos

---

**Dúvidas?** Consulte `MANUAL_COMPLETO.md` ou a [documentação do Firebase](https://firebase.google.com/docs)
