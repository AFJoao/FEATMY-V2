# Manual Completo - Personal Trainer App

## Índice
1. [Visão Geral](#visão-geral)
2. [Estrutura do Projeto](#estrutura-do-projeto)
3. [Configuração Inicial](#configuração-inicial)
4. [Configuração do Firebase](#configuração-do-firebase)
5. [Regras de Segurança do Firestore](#regras-de-segurança-do-firestore)
6. [Instalação e Teste Local](#instalação-e-teste-local)
7. [Deploy na Vercel](#deploy-na-vercel)
8. [Deploy no Firebase Hosting](#deploy-no-firebase-hosting)
9. [Testes Funcionais](#testes-funcionais)
10. [Troubleshooting](#troubleshooting)

---

## Visão Geral

O **Personal Trainer App** é uma aplicação web minimalista desenvolvida com **HTML, CSS e JavaScript puros**, sem dependências de frameworks. A aplicação utiliza **Firebase Authentication** para autenticação de usuários e **Firestore** para armazenamento de dados.

### Funcionalidades Principais

- **Autenticação**: Cadastro e login com email/senha
- **Dois Tipos de Usuários**: Personal Trainer e Aluno
- **Painel do Personal Trainer**: Criar exercícios, gerenciar treinos e associar a alunos
- **Painel do Aluno**: Visualizar treinos atribuídos organizados por semana
- **Proteção de Rotas**: Acesso baseado no tipo de usuário
- **Persistência de Dados**: Todos os dados armazenados no Firestore

### Tecnologias Utilizadas

| Tecnologia | Versão | Propósito |
|-----------|--------|----------|
| HTML5 | - | Estrutura das páginas |
| CSS3 | - | Estilos minimalistas |
| JavaScript (ES6+) | - | Lógica da aplicação |
| Firebase SDK | 9.22.0 | Autenticação e Firestore |
| Firebase Hosting | - | Deployment |

---

## Estrutura do Projeto

```
personal-trainer-app/
├── index.html                          # Página principal (SPA)
├── css/
│   └── style.css                       # Estilos globais minimalistas
├── js/
│   ├── config.js                       # Configuração do Firebase
│   ├── auth.js                         # Gerenciamento de autenticação
│   ├── router.js                       # Sistema de roteamento
│   ├── db.js                           # Operações do Firestore
│   └── main.js                         # Inicialização (opcional)
├── pages/
│   ├── login.html                      # Página de login
│   ├── signup.html                     # Página de cadastro
│   ├── personal/
│   │   ├── dashboard.html              # Dashboard do Personal
│   │   ├── exercises.html              # Gerenciar exercícios
│   │   └── create-workout.html         # Criar treino
│   └── student/
│       ├── dashboard.html              # Dashboard do Aluno
│       └── view-workout.html           # Visualizar treino
├── assets/                             # Pasta para imagens/ícones (opcional)
├── MANUAL_COMPLETO.md                  # Este arquivo
└── README.md                           # Documentação básica

```

### Descrição dos Arquivos Principais

**`index.html`**: Página principal que funciona como Single Page Application (SPA). Carrega dinamicamente as páginas conforme o usuário navega.

**`js/config.js`**: Contém a configuração do Firebase. Você deve substituir os valores de placeholder pelas credenciais do seu projeto Firebase.

**`js/auth.js`**: Gerencia autenticação de usuários, incluindo cadastro, login, logout e verificação de estado de autenticação.

**`js/router.js`**: Sistema de roteamento que controla a navegação entre páginas e implementa proteção de rotas baseada no tipo de usuário.

**`js/db.js`**: Operações com Firestore para criar, ler, atualizar e deletar dados de usuários, exercícios e treinos.

**`css/style.css`**: Estilos CSS minimalistas em preto e branco, totalmente responsivos.

---

## Configuração Inicial

### Pré-requisitos

Antes de começar, você precisa ter:

1. Uma conta no [Firebase Console](https://console.firebase.google.com/)
2. Node.js instalado (para testes locais com servidor)
3. Um editor de texto ou IDE (VS Code recomendado)
4. Git instalado (para versionamento)

### Passo 1: Criar Projeto no Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Clique em "Adicionar projeto"
3. Preencha o nome do projeto (ex: "personal-trainer-app")
4. Desmarque "Habilitar Google Analytics" (opcional)
5. Clique em "Criar projeto"
6. Aguarde o projeto ser criado

### Passo 2: Obter Credenciais do Firebase

1. No Firebase Console, clique no ícone de engrenagem (Configurações do projeto)
2. Vá para a aba "Geral"
3. Desça até "Seus aplicativos"
4. Clique em "Adicionar aplicativo" e selecione "Web"
5. Preencha o apelido do aplicativo (ex: "personal-trainer-web")
6. Marque "Também vou configurar o Firebase Hosting"
7. Clique em "Registrar aplicativo"
8. **Copie o objeto de configuração** que aparecerá (você usará isso no próximo passo)

### Passo 3: Configurar Credenciais no Projeto

1. Abra o arquivo `js/config.js` no seu editor
2. Substitua os valores de placeholder pelos valores da sua configuração:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",           // Seu apiKey
  authDomain: "seu-projeto.firebaseapp.com",                  // Seu authDomain
  projectId: "seu-projeto",                                   // Seu projectId
  storageBucket: "seu-projeto.appspot.com",                   // Seu storageBucket
  messagingSenderId: "123456789012",                          // Seu messagingSenderId
  appId: "1:123456789012:web:abcdefghijklmnopqrst"           // Seu appId
};
```

3. Salve o arquivo

---

## Configuração do Firebase

### Habilitar Firebase Authentication

1. No Firebase Console, vá para "Autenticação" (no menu esquerdo)
2. Clique em "Começar"
3. Na aba "Provedores de login", clique em "Email/Senha"
4. Habilite "Email/Senha"
5. Clique em "Salvar"

### Criar Firestore Database

1. No Firebase Console, vá para "Firestore Database"
2. Clique em "Criar banco de dados"
3. Selecione "Iniciar no modo de teste" (você configurará as regras depois)
4. Selecione a localização mais próxima (ex: "us-central1")
5. Clique em "Criar"

### Criar Coleções no Firestore

O Firestore criará as coleções automaticamente quando você salvar o primeiro documento. As coleções necessárias são:

| Coleção | Descrição |
|---------|-----------|
| `users` | Armazena dados dos usuários (Personal e Aluno) |
| `exercises` | Armazena exercícios criados pelos Personals |
| `workouts` | Armazena treinos criados pelos Personals |

**Estrutura de cada coleção:**

**Coleção `users`:**
```json
{
  "uid": "string",
  "name": "string",
  "email": "string",
  "userType": "personal" | "student",
  "createdAt": "timestamp",
  "students": ["array de IDs"],
  "assignedWorkouts": ["array de IDs"]
}
```

**Coleção `exercises`:**
```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "videoUrl": "string (URL do YouTube)",
  "createdBy": "string (UID do Personal)",
  "createdAt": "timestamp"
}
```

**Coleção `workouts`:**
```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "personalId": "string (UID do Personal)",
  "studentId": "string (UID do Aluno) ou null",
  "days": {
    "monday": [
      {
        "exerciseId": "string",
        "exerciseName": "string",
        "sets": "string",
        "reps": "string",
        "notes": "string"
      }
    ],
    "tuesday": [...],
    "wednesday": [...],
    "thursday": [...],
    "friday": [...],
    "saturday": [...],
    "sunday": [...]
  },
  "createdAt": "timestamp"
}
```

---

## Regras de Segurança do Firestore

As regras de segurança garantem que:
- Usuários só acessem seus próprios dados
- Personals só criem e editem seus próprios exercícios e treinos
- Alunos só visualizem treinos atribuídos a eles

### Configurar Regras

1. No Firebase Console, vá para "Firestore Database"
2. Clique na aba "Regras"
3. Substitua o conteúdo pelas regras abaixo:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Coleção de usuários
    match /users/{userId} {
      // Usuário pode ler seus próprios dados
      allow read: if request.auth.uid == userId;
      // Usuário pode escrever seus próprios dados
      allow write: if request.auth.uid == userId;
    }

    // Coleção de exercícios
    match /exercises/{exerciseId} {
      // Qualquer usuário autenticado pode ler
      allow read: if request.auth != null;
      // Apenas o criador pode escrever/deletar
      allow write: if request.auth.uid == resource.data.createdBy || 
                      request.auth.uid == request.resource.data.createdBy;
    }

    // Coleção de treinos
    match /workouts/{workoutId} {
      // Personal pode ler seus próprios treinos
      // Aluno pode ler treinos atribuídos a ele
      allow read: if request.auth.uid == resource.data.personalId || 
                     request.auth.uid == resource.data.studentId;
      
      // Apenas o Personal pode criar/editar/deletar
      allow write: if request.auth.uid == resource.data.personalId || 
                      request.auth.uid == request.resource.data.personalId;
    }

    // Negar acesso padrão
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

4. Clique em "Publicar"

---

## Instalação e Teste Local

### Opção 1: Usando um Servidor HTTP Simples (Python)

Se você tem Python instalado:

```bash
# Navegue até a pasta do projeto
cd personal-trainer-app

# Python 3
python -m http.server 8000

# Ou Python 2
python -m SimpleHTTPServer 8000
```

Abra o navegador em `http://localhost:8000`

### Opção 2: Usando Node.js HTTP Server

```bash
# Instale o http-server globalmente
npm install -g http-server

# Navegue até a pasta do projeto
cd personal-trainer-app

# Inicie o servidor
http-server -p 8000
```

Abra o navegador em `http://localhost:8000`

### Opção 3: Usando VS Code Live Server

1. Instale a extensão "Live Server" no VS Code
2. Clique com botão direito em `index.html`
3. Selecione "Open with Live Server"

### Testando Localmente

1. Acesse a aplicação no navegador
2. Clique em "Cadastre-se aqui" na página de login
3. Preencha os dados:
   - Nome: "João Silva"
   - Email: "joao@example.com"
   - Senha: "senha123"
   - Tipo: "Personal Trainer"
4. Clique em "Cadastrar"
5. Você deve ser redirecionado para o dashboard do Personal

---

## Deploy na Vercel

### Pré-requisitos

1. Conta no [Vercel](https://vercel.com/)
2. Git instalado
3. Repositório GitHub com o projeto

### Passo 1: Preparar o Projeto no GitHub

```bash
# Inicializar repositório Git (se não estiver)
git init

# Adicionar todos os arquivos
git add .

# Fazer commit
git commit -m "Initial commit: Personal Trainer App"

# Adicionar remote (substitua seu-usuario e seu-repo)
git remote add origin https://github.com/seu-usuario/seu-repo.git

# Fazer push
git push -u origin main
```

### Passo 2: Conectar ao Vercel

1. Acesse [Vercel](https://vercel.com/)
2. Clique em "New Project"
3. Selecione seu repositório GitHub
4. Clique em "Import"
5. Configure as variáveis de ambiente (opcional - não necessário para este projeto)
6. Clique em "Deploy"

### Passo 3: Configurar Domínio (Opcional)

1. No painel do Vercel, vá para "Settings" > "Domains"
2. Adicione seu domínio customizado
3. Configure os registros DNS conforme as instruções

---

## Deploy no Firebase Hosting

### Pré-requisitos

1. Firebase CLI instalado: `npm install -g firebase-tools`
2. Conta no Firebase
3. Projeto Firebase criado

### Passo 1: Instalar Firebase CLI

```bash
npm install -g firebase-tools
```

### Passo 2: Fazer Login no Firebase

```bash
firebase login
```

Isso abrirá uma janela do navegador para você fazer login.

### Passo 3: Inicializar Firebase Hosting

```bash
# Navegue até a pasta do projeto
cd personal-trainer-app

# Inicializar Firebase
firebase init hosting
```

Responda as perguntas:
- "What do you want to use as your public directory?" → `.` (ou `public` se quiser separar)
- "Configure as a single-page app (rewrite all urls to index.html)?" → `Y`
- "Set up automatic builds and deploys with GitHub?" → `N` (opcional)

### Passo 4: Deploy

```bash
firebase deploy
```

Você receberá uma URL de hosting como: `https://seu-projeto.web.app`

---

## Testes Funcionais

### Teste 1: Cadastro de Usuário

**Objetivo**: Verificar se o cadastro funciona corretamente.

**Passos**:
1. Acesse a aplicação
2. Clique em "Cadastre-se aqui"
3. Preencha:
   - Nome: "Maria Silva"
   - Email: "maria@example.com"
   - Senha: "senha123"
   - Confirmar Senha: "senha123"
   - Tipo: "Aluno"
4. Clique em "Cadastrar"

**Resultado Esperado**: Redirecionamento para o dashboard do Aluno.

### Teste 2: Login

**Objetivo**: Verificar se o login funciona corretamente.

**Passos**:
1. Faça logout (se estiver logado)
2. Preencha:
   - Email: "maria@example.com"
   - Senha: "senha123"
3. Clique em "Entrar"

**Resultado Esperado**: Redirecionamento para o dashboard do Aluno.

### Teste 3: Criar Exercício (Personal)

**Objetivo**: Verificar se o Personal consegue criar exercícios.

**Passos**:
1. Faça login como Personal Trainer
2. Clique em "Exercícios"
3. Preencha:
   - Nome: "Supino"
   - Descrição: "Exercício para peito"
   - URL do Vídeo: "https://www.youtube.com/embed/dQw4w9WgXcQ"
4. Clique em "Criar Exercício"

**Resultado Esperado**: Mensagem de sucesso e exercício aparece na lista.

### Teste 4: Criar Treino (Personal)

**Objetivo**: Verificar se o Personal consegue criar treinos.

**Passos**:
1. Faça login como Personal Trainer
2. Clique em "Criar Treino"
3. Preencha:
   - Nome: "Treino A"
   - Descrição: "Treino de peito e costas"
4. Selecione dias: Segunda, Quarta, Sexta
5. Clique em "Adicionar" para cada exercício
6. Preencha:
   - Séries: "3"
   - Repetições: "10"
   - Observações: "Fazer com cuidado"
7. Selecione aluno (opcional)
8. Clique em "Salvar Treino"

**Resultado Esperado**: Redirecionamento para dashboard com treino listado.

### Teste 5: Visualizar Treino (Aluno)

**Objetivo**: Verificar se o Aluno consegue visualizar treinos.

**Passos**:
1. Faça login como Aluno
2. Clique em "Ver Treino"
3. Navegue entre os dias

**Resultado Esperado**: Exercícios aparecem com vídeo, séries e repetições.

### Teste 6: Proteção de Rotas

**Objetivo**: Verificar se as rotas estão protegidas.

**Passos**:
1. Faça logout
2. Tente acessar `#/personal/dashboard` na URL
3. Você deve ser redirecionado para login

**Resultado Esperado**: Redirecionamento para página de login.

### Teste 7: Responsividade Mobile

**Objetivo**: Verificar se a aplicação funciona em dispositivos móveis.

**Passos**:
1. Abra a aplicação em um navegador mobile ou use o DevTools do navegador (F12)
2. Mude para modo mobile
3. Teste todas as funcionalidades

**Resultado Esperado**: Interface se adapta ao tamanho da tela.

---

## Troubleshooting

### Problema: "Firebase não está definido"

**Solução**: Verifique se os scripts do Firebase estão carregando corretamente em `index.html`. Certifique-se de que as URLs estão corretas:

```html
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js"></script>
```

### Problema: "Erro de autenticação"

**Solução**: Verifique se:
1. Firebase Authentication está habilitado no Firebase Console
2. As credenciais em `js/config.js` estão corretas
3. O email/senha estão corretos

### Problema: "Dados não aparecem no Firestore"

**Solução**: Verifique se:
1. Firestore Database foi criado
2. As regras de segurança permitem leitura/escrita
3. O usuário está autenticado

### Problema: "Página em branco ao carregar"

**Solução**: 
1. Abra o console do navegador (F12)
2. Procure por erros de JavaScript
3. Verifique se todos os arquivos JS estão sendo carregados
4. Certifique-se de que `index.html` está sendo servido por um servidor HTTP (não abra como arquivo local)

### Problema: "Vídeo não carrega"

**Solução**: 
1. Certifique-se de que está usando URLs de embed do YouTube
2. URLs corretas começam com `https://www.youtube.com/embed/`
3. Não use URLs de watch (`https://www.youtube.com/watch?v=`)

### Problema: "Estilos não carregam"

**Solução**: Verifique se o caminho para `css/style.css` está correto em `index.html`. Deve ser:

```html
<link rel="stylesheet" href="css/style.css">
```

---

## Próximos Passos

Depois de ter a aplicação funcionando, você pode:

1. **Customizar Estilos**: Edite `css/style.css` para adicionar cores e design
2. **Adicionar Funcionalidades**: Implemente feedback de treinos, histórico, etc.
3. **Melhorar UX**: Adicione animações e transições
4. **Implementar Notificações**: Use Firebase Cloud Messaging para notificar alunos
5. **Adicionar Relatórios**: Crie gráficos de progresso dos alunos

---

## Suporte e Documentação

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Vercel Documentation](https://vercel.com/docs)
- [MDN Web Docs](https://developer.mozilla.org/)

---

## Licença

Este projeto é fornecido como está, sem garantias. Sinta-se livre para modificar e usar conforme necessário.

---

**Última atualização**: Dezembro 2024
**Versão**: 1.0.0
