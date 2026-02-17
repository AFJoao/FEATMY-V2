# Personal Trainer App

Uma aplicação web minimalista para gerenciamento de treinos entre Personal Trainers e Alunos, desenvolvida com HTML, CSS e JavaScript puros, integrada com Firebase.

## 🚀 Início Rápido

### 1. Configurar Firebase

1. Crie um projeto em [Firebase Console](https://console.firebase.google.com/)
2. Habilite Firebase Authentication (Email/Senha)
3. Crie um Firestore Database
4. Copie suas credenciais do Firebase
5. Abra `js/config.js` e substitua os valores de placeholder

### 2. Testar Localmente

```bash
# Com Python 3
python -m http.server 8000

# Ou com Node.js
npm install -g http-server
http-server -p 8000
```

Abra `http://localhost:8000` no navegador.

### 3. Deploy

**Vercel:**
```bash
git push origin main
# Conecte seu repositório no Vercel
```

**Firebase Hosting:**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

## 📁 Estrutura do Projeto

```
personal-trainer-app/
├── index.html                 # Página principal (SPA)
├── css/style.css             # Estilos minimalistas
├── js/
│   ├── config.js             # Configuração Firebase
│   ├── auth.js               # Autenticação
│   ├── router.js             # Roteamento
│   └── db.js                 # Operações Firestore
└── pages/
    ├── login.html
    ├── signup.html
    ├── personal/
    │   ├── dashboard.html
    │   ├── exercises.html
    │   └── create-workout.html
    └── student/
        ├── dashboard.html
        └── view-workout.html
```

## ✨ Funcionalidades

- ✅ Autenticação com Firebase (Email/Senha)
- ✅ Dois tipos de usuários (Personal Trainer e Aluno)
- ✅ Criar e gerenciar exercícios
- ✅ Criar treinos com exercícios por dia da semana
- ✅ Associar treinos a alunos
- ✅ Visualizar treinos com vídeos embarcados
- ✅ Navegação entre dias da semana
- ✅ Proteção de rotas baseada em tipo de usuário
- ✅ Interface responsiva e minimalista

## 🔐 Segurança

As regras do Firestore garantem que:
- Usuários só acessem seus próprios dados
- Personals só criem seus próprios exercícios e treinos
- Alunos só visualizem treinos atribuídos a eles

## 📚 Documentação Completa

Veja `MANUAL_COMPLETO.md` para:
- Configuração detalhada do Firebase
- Regras de segurança do Firestore
- Testes funcionais
- Troubleshooting
- Deploy em produção

## 🛠️ Tecnologias

- HTML5
- CSS3
- JavaScript (ES6+)
- Firebase SDK 9.22.0
- Firebase Authentication
- Firestore Database

## 📝 Licença

Livre para uso e modificação.

## 🤝 Suporte

Para dúvidas sobre Firebase, consulte:
- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Guide](https://firebase.google.com/docs/firestore)
- [Firebase Auth](https://firebase.google.com/docs/auth)
