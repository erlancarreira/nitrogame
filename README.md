# Nitro Rush

Um jogo de kart multijogador em tempo real construído com Next.js, Three.js e Rapier, rodando direto no navegador. Inspirado em Mario Kart — drift com mini-turbo, sistema de itens, bots com IA, modo online P2P via WebRTC e controles touch para mobile.

![Gameplay](https://nitrorush.ymonetize.fun)

---

## Sumário

- [Funcionalidades](#funcionalidades)
- [Tech Stack](#tech-stack)
- [Início Rápido](#início-rápido)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Scripts Disponíveis](#scripts-disponíveis)
- [Como Jogar](#como-jogar)
- [Modos de Jogo](#modos-de-jogo)
- [Itens](#itens)
- [Arquitetura](#arquitetura)
- [Documentação Técnica](#documentação-técnica)

---

## Funcionalidades

- **Física realista** — Rapier WASM, colisões, gravidade, paredes e superfícies
- **Drift Mario Kart style** — 3 tiers de mini-turbo (0.8s / 1.5s / 2.5s)
- **Sistema de itens** — Cogumelo, Banana, Concha Vermelha, Estrela, Óleo
- **IA de bots** — Pathfinding por waypoints + spline, dificuldade fácil/médio/difícil
- **Multiplayer online** — Socket.IO + WebRTC P2P, até 8 jogadores por sala
- **Multiplayer local** — Jogue sozinho contra bots no mesmo dispositivo
- **Controles touch** — Analógico virtual para mobile (joystick + botões)
- **Classificação em tempo real** — Ranking por progresso no spline, anti-cheat por checkpoints
- **Áudio espacial** — Howler.js, engine, drift e SFX 3D
- **Produção com cloudflare tunnel** — Suporte a deploy com `cloudflared`

---

## Tech Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 + React 19 |
| 3D / Física | Three.js 0.182 + @react-three/fiber 9.5 + @react-three/rapier 2.2 |
| Networking | Socket.IO 4.8 + WebRTC DataChannels |
| Áudio | Howler.js 2.2 |
| UI | Tailwind CSS 4 + Radix UI |
| Linguagem | TypeScript 5 |
| Servidor | Node.js standalone (tsx) |

---

## Início Rápido

### Pré-requisitos

- Node.js 20+
- npm ou yarn

### Instalação

```bash
git clone https://github.com/erlancarreira/nitrogame.git
cd nitrogame
npm install
```

### Configurar variáveis de ambiente

```bash
cp .env.local.example .env.local
# Editar .env.local com seus valores (ver seção abaixo)
```

### Rodar em desenvolvimento

```bash
# Terminal 1 — servidor de jogo (Socket.IO, porta 3001)
npm run server

# Terminal 2 — frontend Next.js (porta 3000)
npm run dev
```

Ou, com um único comando:

```bash
npm run dev:all
```

Acesse: `http://localhost:3000`

---

## Variáveis de Ambiente

Crie um arquivo `.env.local` na raiz do projeto:

```env
# URL do servidor de jogo Socket.IO
NEXT_PUBLIC_GAME_SERVER=http://localhost:3001

# URL pública do site (para links e CORS)
NEXT_PUBLIC_SITE_URL=https://seudominio.com

# Porta do servidor de jogo
PORT=3001

# Cloudflare TURN — NAT traversal para WebRTC
# Obtenha em: https://dash.cloudflare.com > Calls > TURN Keys
CF_TURN_KEY_ID=
CF_TURN_API_TOKEN=

# Metered.ca TURN — alternativa de relay WebRTC
# Obtenha em: https://www.metered.ca/turn-server
METERED_API_KEY=
METERED_APP_NAME=seuapp.metered.live
```

> **Nota:** Os servidores TURN são necessários para multiplayer online em redes com NAT restritivo (ex: 4G). Para LAN local ou desenvolvimento, podem ser omitidos.

---

## Scripts Disponíveis

```bash
npm run dev          # Next.js em modo desenvolvimento (porta 3000, bind 0.0.0.0)
npm run server       # Servidor Socket.IO standalone (porta 3001)
npm run dev:all      # Frontend + servidor em paralelo
npm run dev:integrated  # Servidor integrado (Next.js + Socket.IO no mesmo processo)

npm run build        # Build de produção
npm run start        # Iniciar build de produção
npm run prod         # Build + servidor integrado + cloudflare tunnel
npm run prod:local   # Build + servidor integrado (sem tunnel)

npm run tunnel       # Cloudflare tunnel (após dev ou start)
npm run lint         # ESLint
```

---

## Como Jogar

### Controles (Teclado)

| Tecla | Ação |
|---|---|
| `W` / `↑` | Acelerar |
| `S` / `↓` | Freiar / Ré |
| `A` / `←` | Virar esquerda |
| `D` / `→` | Virar direita |
| `Espaço` | Drift |
| `Shift` | Usar item |
| `R` | Resetar posição |

### Controles (Mobile)

- **Joystick esquerdo** — Direção analógica
- **Botão A** — Acelerar / Freiar (analógico)
- **Botão Drift** — Iniciar drift
- **Botão Item** — Usar item coletado

### Drift e Mini-Turbo

Segure `Espaço` enquanto vira para iniciar o drift. O indicador muda de cor conforme o tempo:

| Tier | Tempo de Drift | Boost | Duração do Boost |
|---|---|---|---|
| Mini-Turbo 1 | ≥ 0.8s | 1.3× velocidade | 0.8s |
| Mini-Turbo 2 | ≥ 1.5s | 1.5× velocidade | 1.2s |
| Mini-Turbo 3 | ≥ 2.5s | 1.8× velocidade | 1.8s |

Solte `Espaço` para ativar o boost. Quanto mais tempo no drift, maior o turbo.

---

## Modos de Jogo

### Corrida Solo (vs Bots)

Escolha número de bots (1–7), dificuldade e número de voltas. A IA navega pela pista usando waypoints e spline. Dificuldades:

| Dificuldade | Velocidade | Aceleração | Raio de Waypoint |
|---|---|---|---|
| Fácil | 85% | 90% | 8m |
| Médio | 100% | 100% | 6m |
| Difícil | 110% | 115% | 4m |

### Multiplayer Online

1. Clique em **Online** no menu principal
2. **Criar Sala** — gera um código de 6 caracteres para compartilhar
3. **Entrar na Sala** — insira o código recebido
4. O host configura mapa, voltas e bots; todos os jogadores veem o lobby em tempo real
5. Quando o host clica **Iniciar**, a corrida começa para todos simultaneamente

A comunicação usa **WebRTC DataChannels** (P2P direto, tipo UDP) para dados de posição, com fallback automático via Socket.IO relay se o P2P falhar.

---

## Itens

Colete as caixas de item espalhadas pela pista. A probabilidade de cada item é baseada na sua posição na corrida:

| Item | Emoji | Efeito |
|---|---|---|
| Cogumelo | 🍄 | Boost de 2× por 2 segundos |
| Banana | 🍌 | Dropa uma casca atrás do kart; causa spin-out em quem pisar |
| Concha Vermelha | 🚀 | Projétil teleguiado que mira o adversário mais próximo |
| Estrela | ⭐ | Invencibilidade + boost de velocidade por 8 segundos |
| Óleo | ⚫ | Dropa uma poça atrás do kart; causa derrapagem em quem passar |

Líderes recebem mais itens defensivos (banana, óleo); últimos recebem itens ofensivos (estrela, concha).

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Browser (Client)                  │
│                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────┐ │
│  │ Next.js  │   │  Three.js +  │   │  Socket.IO  │ │
│  │   App    │──▶│ R3F + Rapier │   │   Client    │ │
│  └──────────┘   └──────────────┘   └─────┬───────┘ │
│                        │                 │         │
│              ┌──────────▼──────┐   ┌─────▼───────┐ │
│              │  Game Physics   │   │  WebRTC     │ │
│              │  (WASM Rapier)  │   │  P2P Data   │ │
│              └─────────────────┘   └─────────────┘ │
└─────────────────────────────────────────────────────┘
                         │ Socket.IO
                         ▼
┌─────────────────────────────────────────────────────┐
│                  Server (Node.js)                    │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Socket.IO Server (port 3001)                │   │
│  │  - Lobby: criar/entrar sala, lobby-update    │   │
│  │  - Signaling: WebRTC offer/answer/ICE        │   │
│  │  - Relay: POS fallback se WebRTC falhar      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

Para documentação técnica detalhada, consulte:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitetura completa do sistema
- [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md) — protocolo de rede e WebRTC
- [`docs/GAMEPLAY.md`](docs/GAMEPLAY.md) — sistemas de jogo (física, itens, IA)

---

## Deploy em Produção

### Com Cloudflare Tunnel (recomendado)

```bash
# Instalar cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

npm run prod
```

Isso executa: `next build` → servidor integrado → tunnel cloudflare público.

### Sem tunnel (servidor próprio)

```bash
npm run build
npm run prod:local
```

Configure um proxy reverso (nginx/caddy) apontando para a porta 3000 (Next.js) e 3001 (Socket.IO).

### Variáveis de ambiente para produção

```env
NEXT_PUBLIC_GAME_SERVER=https://socket.seudominio.com
NEXT_PUBLIC_SITE_URL=https://seudominio.com
NODE_ENV=production
```

---

## Licença

Este projeto é privado — todos os direitos reservados à YMONETIZE Labs.
