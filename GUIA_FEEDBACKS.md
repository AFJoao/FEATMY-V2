# 📍 GUIA: Onde Encontrar os Botões de Feedback

## 🎯 Para o PERSONAL TRAINER

### Localização do Botão "Feedbacks"
**No Dashboard do Personal** (`/personal/dashboard`):

```
┌─────────────────────────────────────────────────────────┐
│  [🏋️ Dashboard Personal]                               │
│                                                          │
│  [Exercícios] [Criar Treino] [💬 Feedbacks] [Sair]     │
│                          ↑                               │
│                    ESTE BOTÃO                           │
└─────────────────────────────────────────────────────────┘
```

**Onde procurar:**
- No topo da página (header)
- Entre o botão "Criar Treino" e o botão "Sair"
- Deve ter um ícone de balão de conversa 💬
- Texto: "Feedbacks"

**Se não aparecer:**
1. Verifique se está logado como PERSONAL (não como aluno)
2. Abra o console (F12) e digite:
   ```javascript
   document.querySelector('a[href="#/personal/feedbacks"]')
   ```
3. Se retornar `null`, o botão não está sendo renderizado

---

## 🎯 Para o ALUNO

### Localização do Botão "Enviar feedback"
**No Dashboard do Aluno** (`/student/dashboard`):

```
┌─────────────────────────────────────────────────────────┐
│  Olá, [Nome]! 👋                                        │
│  Confira seus treinos da semana                         │
│                                                          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                  │
│  │ SEG  │ │ TER  │ │ QUA  │ │ QUI  │                  │
│  │      │ │      │ │      │ │      │                  │
│  │[Card]│ │[Card]│ │[Card]│ │[Card]│                  │
│  │      │ │      │ │      │ │      │                  │
│  │[Nome]│ │[Nome]│ │[Nome]│ │[Nome]│                  │
│  │do    │ │do    │ │do    │ │do    │                  │
│  │Treino│ │Treino│ │Treino│ │Treino│                  │
│  │      │ │      │ │      │ │      │                  │
│  │[📊]  │ │[📊]  │ │[📊]  │ │[📊]  │                  │
│  │      │ │      │ │      │ │      │                  │
│  │[💬   │ │[💬   │ │[💬   │ │[💬   │                  │
│  │Enviar│ │Enviar│ │Enviar│ │Enviar│                  │
│  │feed- │ │feed- │ │feed- │ │feed- │                  │
│  │back] │ │back] │ │back] │ │back] │                  │
│  │      │ │      │ │      │ │      │                  │
│  │ ↑    │ │ ↑    │ │ ↑    │ │ ↑    │                  │
│  │ESTE  │ │ESTE  │ │ESTE  │ │ESTE  │                  │
│  └──────┘ └──────┘ └──────┘ └──────┘                  │
└─────────────────────────────────────────────────────────┘
```

**Onde procurar:**
- No dashboard do aluno (após fazer login como ALUNO)
- Em cada card de treino (um card por dia da semana)
- Na parte INFERIOR de cada card
- Só aparece se o treino tiver exercícios naquele dia
- Texto: "Enviar feedback" com ícone 💬

**Se não aparecer:**
1. Verifique se está logado como ALUNO (não como personal)
2. Verifique se há treinos atribuídos ao aluno
3. Verifique se o treino tem exercícios no dia específico
4. Abra o console (F12) e procure por:
   ```
   Renderizando X treino(s) para [dia]
   Feedback check - Workout: [id], Day: [day], Week: [week], HasFeedback: false
   ```

---

## 🔍 Como Testar

### Teste 1: Personal vê botão "Feedbacks"
1. Faça login como **PERSONAL**
2. Vá para `/personal/dashboard`
3. Olhe no **header** (topo da página)
4. Deve ver: `[Exercícios] [Criar Treino] [💬 Feedbacks] [Sair]`

### Teste 2: Aluno vê botão "Enviar feedback"
1. Faça login como **ALUNO**
2. Vá para `/student/dashboard`
3. Veja os **cards de treino** por dia da semana
4. Role para baixo em cada card
5. Deve ver botão **"Enviar feedback"** na parte inferior

### Teste 3: Verificar no Console
Abra o DevTools (F12) → Console e procure por:
- `✓ Dashboard Personal carregado - Botão Feedbacks deve estar visível no header`
- `✓ Dashboard Aluno carregado - feedbackModel disponível: true`
- `Renderizando X treino(s) para [dia]`

---

## ⚠️ Problemas Comuns

### "Não vejo o botão Feedbacks no Personal"
- ✅ Verifique se está logado como PERSONAL
- ✅ Verifique se está na página `/personal/dashboard`
- ✅ Limpe o cache (Ctrl + Shift + R)
- ✅ Verifique o console para erros

### "Não vejo o botão Enviar feedback no Aluno"
- ✅ Verifique se está logado como ALUNO
- ✅ Verifique se há treinos atribuídos
- ✅ Verifique se o treino tem exercícios no dia
- ✅ Role a página para baixo nos cards
- ✅ Verifique o console para erros

### "A página não carrega"
- ✅ Verifique se o servidor está rodando na porta 8000
- ✅ Acesse `http://localhost:8000`
- ✅ Verifique o console do navegador (F12)

