# Multiplayer — Protocolo de Rede

Este documento descreve a arquitetura de rede do Nitro Rush: topologia, protocolo de mensagens, sincronização de estado e fluxo de uma sessão online.

---

## Sumário

- [Topologia](#topologia)
- [Socket.IO — Lobby e Signaling](#socketio--lobby-e-signaling)
- [WebRTC DataChannels — Dados de Jogo](#webrtc-datachannels--dados-de-jogo)
- [Fluxo de uma Sessão](#fluxo-de-uma-sessão)
- [Protocolo de Mensagens](#protocolo-de-mensagens)
- [Sincronização de Estado](#sincronização-de-estado)
- [Snapshot Interpolation](#snapshot-interpolation)
- [Predição Client-side](#predição-client-side)
- [Sincronização de Itens](#sincronização-de-itens)
- [TURN Servers (NAT Traversal)](#turn-servers-nat-traversal)
- [Configuração do Servidor](#configuração-do-servidor)

---

## Topologia

O Nitro Rush usa uma arquitetura **híbrida Socket.IO + WebRTC**:

```
                    ┌─────────────────┐
                    │   Socket.IO     │
                    │   Server :3001  │
                    │   (lobby +      │
                    │   signaling +   │
                    │   relay fallback│
                    └────────┬────────┘
                             │ WebSocket
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
         │ Host    │    │Player 2 │    │Player 3 │
         │ (também │    │         │    │         │
         │ cria    │    │         │    │         │
         │ bots)   │    │         │    │         │
         └────┬────┘    └────┬────┘    └────┬────┘
              │              │              │
              └──────────────┼──────────────┘
                    WebRTC DataChannels (P2P)
                    unreliable + unordered (UDP-like)
                    usado para mensagens POS (posição)
```

**Socket.IO** — Lobby (criar/entrar sala), signaling WebRTC, mensagens de estado de jogo, relay de fallback.

**WebRTC DataChannels** — Posições em tempo real. Unreliable + unordered = dados antigos descartados, sem head-of-line blocking. Mesh completo: cada jogador conecta P2P a todos os outros.

---

## Socket.IO — Lobby e Signaling

### Eventos emitidos pelo cliente

| Evento | Payload | Descrição |
|---|---|---|
| `create-room` | `{ playerData }` | Host cria nova sala |
| `join-room` | `{ roomCode, playerData }` | Cliente entra na sala |
| `lobby-ready` | `{ isReady }` | Marca jogador como pronto |
| `settings-update` | `{ map, laps, ... }` | Host muda configurações |
| `start-game` | — | Host inicia a corrida |
| `webrtc-offer` | `{ targetId, offer }` | Offer SDP para signaling |
| `webrtc-answer` | `{ targetId, answer }` | Answer SDP |
| `webrtc-ice` | `{ targetId, candidate }` | ICE candidate |
| `pos` | `NetworkMessage` | Relay de posição (fallback) |
| `broadcast` | `NetworkMessage` | Broadcast de estado de jogo |

### Eventos recebidos do servidor

| Evento | Payload | Descrição |
|---|---|---|
| `room-created` | `{ roomCode, playerId }` | Confirmação da sala + ID |
| `room-joined` | `{ roomCode, playerId, players, settings }` | Entrou na sala |
| `lobby-update` | `{ players, settings }` | Estado atualizado do lobby |
| `game-start` | `{ players, settings, startTime }` | Inicia corrida |
| `webrtc-offer` | `{ fromId, offer }` | Offer de outro jogador |
| `webrtc-answer` | `{ fromId, answer }` | Answer de outro jogador |
| `webrtc-ice` | `{ fromId, candidate }` | ICE candidate |
| `broadcast` | `NetworkMessage` | Mensagem de broadcast |
| `player-disconnected` | `{ playerId }` | Jogador saiu |

---

## WebRTC DataChannels — Dados de Jogo

### Negociação

Após o evento `game-start`, os clientes iniciam a negociação WebRTC. Para evitar colisão de offers (ambos tentando oferecer ao mesmo tempo), o cliente com o **menor `socket.id` lexicograficamente** envia o offer:

```ts
// lib/game/networking.ts
const shouldOffer = myId < peerId  // string comparison
if (shouldOffer) {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('webrtc-offer', { targetId: peerId, offer })
}
```

### Configuração do DataChannel

```ts
const channel = pc.createDataChannel('game', {
    ordered: false,     // Sem ordering — frames antigos podem chegar fora de ordem
    maxRetransmits: 0   // Sem retransmissão — equivalente a UDP
})
```

### Fallback para Socket.IO relay

Se o DataChannel não conectar em 5 segundos (NAT restritivo, firewall), o sistema faz fallback automático para relay via Socket.IO:

```ts
// Se WebRTC falhar:
networkManager.broadcast = (msg) => socket.volatile.emit('pos', msg)
// socket.volatile = descarta se congestionado, igual a UDP
```

---

## Fluxo de uma Sessão

```
Host                            Server                          Player 2
  │                               │                                 │
  │──── create-room ──────────────▶│                                 │
  │◀─── room-created (code=ABC) ───│                                 │
  │                               │                                 │
  │                               │◀──── join-room (code=ABC) ──────│
  │◀─── lobby-update ─────────────│────── lobby-update ─────────────▶│
  │                               │                                 │
  │──── settings-update ──────────▶│────── lobby-update ─────────────▶│
  │                               │                                 │
  │──── start-game ───────────────▶│────── game-start ───────────────▶│
  │◀─── game-start ───────────────│                                 │
  │                               │                                 │
  │ [WebRTC negotiation via signaling]                              │
  │──── webrtc-offer ─────────────▶│────── webrtc-offer ─────────────▶│
  │◀─── webrtc-answer ────────────│◀───── webrtc-answer ─────────────│
  │──── webrtc-ice ───────────────▶│────── webrtc-ice ───────────────▶│
  │◀─── webrtc-ice ───────────────│◀───── webrtc-ice ─────────────── │
  │                               │                                 │
  │◀══════ P2P DataChannel ════════════════════════════════════════▶│
  │         (unreliable/unordered — UDP-like)                       │
  │                               │                                 │
  [Corrida em andamento]          │                                 │
  │──── POS (20Hz) ──────────────────────────────────────────────▶ │
  │◀─── POS (20Hz) ──────────────────────────────────────────────── │
```

---

## Protocolo de Mensagens

Todas as mensagens seguem a interface `NetworkMessage` em `lib/game/networking.ts`:

```ts
interface NetworkMessage {
    type: string
    fromId?: string
    // campos específicos por tipo...
}
```

### Mensagens de posição (20Hz, WebRTC P2P)

```ts
{ type: "POS",
  x, y, z,       // posição 3D
  rot,            // rotação Y (radianos)
  speed,          // velocidade atual
  lapProgress,    // progresso na volta [0, 1)
  seq             // sequence number para interpolação
}
```

### Mensagens de estado de jogo (Socket.IO broadcast)

```ts
{ type: "BANANA_SPAWN",   bananaNetId, position, rotationY, ownerId }
{ type: "OIL_SPAWN",      position, ownerId }
{ type: "SHELL_SPAWN",    shell: { id, ownerId, targetId, startPosition, startRotation } }
{ type: "SHELL_DESPAWN",  shellId }
{ type: "ITEM_HIT",       targetId, effect: "spinOut" | "oilSlip", itemId?, itemType? }
{ type: "PLAYER_FINISHED", finishTime }
{ type: "WORLD_SNAPSHOT",  snapshot: { shells, bananas, oils } }
```

---

## Sincronização de Estado

### Autoridade

O modelo usa **autoridade da vítima** para hits de itens:

- Quem sofre o hit (vítima) processa o efeito localmente e transmite `ITEM_HIT`
- Remoto recebe `ITEM_HIT` e aplica o efeito localmente
- Isso evita falsos positivos do lado de quem dropou o item

Para bots, o **host** tem autoridade:
```ts
if (networkManager.isHost && botRefs.current[kartId]) {
    botRefs.current[kartId].spinOut()
    networkManager.broadcast({ type: "ITEM_HIT", targetId: kartId, effect: "spinOut" })
}
```

### World Snapshot

Quando um novo jogador entra no jogo (ou reconecta), o host envia um `WORLD_SNAPSHOT` com o estado atual de todos os itens (bananas, óleos, conchas ativas):

```ts
getWorldSnapshot() {
    return {
        shells: redShells,
        bananas: bananaPoolRef.current?.getSnapshot(),
        oils: oilPoolRef.current?.getSnapshot()
    }
}
```

### Lap e Checkpoints — NÃO sincronizados via rede

Lap counter e checkpoints são calculados **localmente** a partir do `lapProgress` recebido. A rede apenas envia `lapProgress` (número float). Isso evita que mensagens atrasadas ou fora de ordem causem laps falsos:

```ts
// handlePositionUpdate — roda localmente para CADA jogador remoto
// baseado no lapProgress recebido via POS
if (checkpoints === 3 && prevProgress > 0.9 && lapProgress < 0.1) {
    newLap = lap + 1
}
```

---

## Snapshot Interpolation

`lib/game/interpolator.ts` + `components/game/RemoteKart.tsx`

Jogadores remotos são renderizados **100ms no passado** para suavizar jitter de rede. O sistema mantém um buffer ring de até 20 snapshots e interpola entre os dois mais próximos ao tempo de renderização:

```ts
class SnapshotBuffer {
    // Ring buffer de 20 snapshots
    // renderTime = now - 100ms

    getInterpolated(renderTime):
        // Encontra snapshotA (antes) e snapshotB (depois) do renderTime
        // Interpola linearmente (posição, rotação SLERP)
        // Se não há snapshot futuro: extrapola por até 300ms usando velocity
}
```

### Extrapolação

Quando não chegam snapshots (pacote perdido, jitter), o sistema extrapola a posição por até 300ms usando a velocidade estimada dos dois últimos snapshots:

```ts
const velocity = (snapshotB.pos - snapshotA.pos) / (snapshotB.time - snapshotA.time)
const extrapolated = lastSnapshot.pos + velocity * elapsed
// Clampado a 300ms para evitar extrapolação excessiva
```

---

## Predição Client-side

`hooks/useNetworkPrediction.ts` — Aplicado apenas ao jogador local em modo online.

O jogador local não espera o servidor confirmar sua posição — ela é aplicada imediatamente (predição). Quando chegam posições do servidor (de outros clientes que não conhecem o host local), o sistema reconcilia suavemente:

```ts
// Online: posição do jogador LOCAL é sempre local (sem latência)
// Posições de OUTROS jogadores passam pelo SnapshotBuffer

// Reconciliação:
// Se diferença < threshold → interpolar suavemente
// Se diferença > threshold → teleportar para posição correta
```

---

## Sincronização de Itens

### Deduplicação

Quando o sensor Rapier e o sistema de proximidade disparam ao mesmo tempo para o mesmo item, um mecanismo de deduplicação evita double-spinOut:

```ts
const dedupKey = `${itemId}_${kartId}`
const lastHit = recentItemHitsRef.get(dedupKey)
if (lastHit && now - lastHit < 600ms) return  // ignora
recentItemHitsRef.set(dedupKey, now)
```

### Banana vs Oil — diferença de cooldown

- **Banana**: Despawnada ao primeiro hit. `ITEM_HIT_DEDUP_MS = 600ms`
- **Óleo**: Persiste. Cooldown de `2100ms` por kart (mesmo kart não pode retriggar por 2.1s)

### Cross-client banana ID

Para bananas, o ID é gerado pelo dropper e incluso no `BANANA_SPAWN`:

```ts
const bananaNetId = `bn_${playerId}_${Date.now()}`
// Todos os clientes usam o MESMO netId para poder despawnar corretamente
```

Quando qualquer cliente recebe `ITEM_HIT` com `itemType: "banana"`:
```ts
bananaPoolRef.current?.despawnByNetId(msg.itemId)
// Funciona independente de qual slot local foi usado para aquela banana
```

---

## TURN Servers (NAT Traversal)

Para conexões WebRTC atrás de NAT simétrico (comum em 4G/CGNAT), STUN não é suficiente e um servidor TURN é necessário como relay.

### Cloudflare TURN (recomendado)

```env
CF_TURN_KEY_ID=seu_key_id
CF_TURN_API_TOKEN=seu_token
```

O servidor gera credenciais TURN temporárias e as envia ao cliente durante a negociação.

### Metered.ca TURN (alternativa)

```env
METERED_API_KEY=sua_chave
METERED_APP_NAME=seuapp.metered.live
```

### Ordem de tentativa de conexão

```
1. STUN (Google) — sem relay, direto se possível
2. Cloudflare TURN — relay via Cloudflare edge
3. Metered.ca TURN — relay alternativo
4. Fallback Socket.IO relay — se WebRTC falhar completamente
```

---

## Configuração do Servidor

`server/index.ts` (standalone) ou `server/integrated.ts` (integrado ao Next.js).

### Standalone (desenvolvimento)

```bash
npm run server  # porta 3001
```

### Integrado (produção)

```bash
npm run prod:local  # next build + servidor integrado na mesma porta
```

### CORS

O servidor Socket.IO aceita qualquer origem (`origin: "*"`) para facilitar desenvolvimento. Em produção, restrinja para seu domínio:

```ts
// server/socket-logic.ts
const io = new Server(httpServer, {
    cors: {
        origin: ["https://seudominio.com"],
        methods: ["GET", "POST"]
    }
})
```

### Logs

O servidor expõe um endpoint `POST /logs` para debug remoto de clientes:

```bash
curl -X POST http://localhost:3001/logs \
  -H "Content-Type: application/json" \
  -d '{"error": "debug info", "state": {...}}'
# Salvo em ./logs/debug-{timestamp}.json
```
