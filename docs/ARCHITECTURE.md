# Arquitetura Técnica — Nitro Rush

Este documento descreve a arquitetura interna do Nitro Rush: game loop, física, renderização, sistemas de jogo e organização do código.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Game Loop](#game-loop)
- [Física (Rapier WASM)](#física-rapier-wasm)
- [Kart do Jogador (KartPro)](#kart-do-jogador-kartpro)
- [Kart dos Bots (BotKart)](#kart-dos-bots-botkart)
- [Sistema de Câmera](#sistema-de-câmera)
- [Classificação e Lap Progress](#classificação-e-lap-progress)
- [Sistema de Pistas](#sistema-de-pistas)
- [Constantes de Física](#constantes-de-física)
- [Presets de Física](#presets-de-física)
- [Áudio](#áudio)
- [Decisões de Design](#decisões-de-design)

---

## Visão Geral

O Nitro Rush é uma aplicação Next.js que roda inteiramente no browser. O jogo 3D é renderizado pelo `@react-three/fiber` (wrapper React para Three.js), com física simulada pelo `@react-three/rapier` (binding WASM do motor Rapier).

```
app/page.tsx
    └── Game.tsx                  ← Orquestrador principal (state, networking, modos)
         ├── MainMenu              ← Lobby, seleção de modo
         └── GameScene.tsx         ← Cena 3D completa
              ├── Physics (Rapier world)
              │    ├── KartPro     ← Kart do jogador local
              │    ├── BotKart × N ← Bots da IA
              │    ├── RemoteKart × N ← Jogadores remotos (online)
              │    ├── Track        ← Geometria + colisores da pista
              │    ├── ItemBoxes    ← Caixas de item
              │    ├── InstancedBananas / InstancedOil ← Itens dropaáveis
              │    └── RedShell × N ← Conchas ativas
              ├── FollowCamera     ← Câmera em terceira pessoa
              └── GameHUD          ← UI sobreposta (fora do canvas 3D)
```

---

## Estrutura de Diretórios

```
components/game/
├── Game.tsx                  Orquestrador: state machine, networking, modo solo/online
├── GameScene.tsx             Cena R3F: monta todos os objetos 3D e física
├── GameHUD.tsx               HUD React (posição, voltas, item, velocímetro, placar)
├── KartPro.tsx               Física + input do kart humano
├── BotKart.tsx               IA + física dos bots
├── RemoteKart.tsx            Interpolação de snapshot para jogadores remotos
├── FollowCamera.tsx          Câmera suave em terceira pessoa
├── CarModel.tsx              Loader de GLB com animação de rodas
├── KartEffects.tsx           Fumaça de drift, marcas de pneu
├── ItemBox.tsx               Caixa de item com sensor de colisão
├── InstancedBananas.tsx      Pool de bananas (instanced mesh + physics)
├── InstancedOil.tsx          Pool de óleo (sensor de colisão)
├── RedShell.tsx              Projétil teleguiado
├── MiniMap.tsx               Minimapa SVG/Canvas
├── MobileControls.tsx        Controles touch analógicos
├── SoundEffects.tsx          Ref imperativo para SFX
├── EngineSound.tsx           Som de motor (pitch por velocidade)
├── SpatialEngineSound.tsx    Som 3D espacial para karts remotos
└── menu/
    ├── ModeSelectView.tsx    Tela de seleção de modo
    ├── LobbySetupView.tsx    Configuração da sala
    ├── LobbyView.tsx         Sala de espera em tempo real
    ├── MenuBackground.tsx    Cena 3D do menu
    └── useOnlineLobby.ts     Hook com toda lógica de networking do lobby

lib/game/
├── kart-physics-core.ts      Núcleo de simulação de física (puro TS, sem R3F)
├── track-path.ts             TrackSpline — projeção no spline para lap progress
├── networking.ts             NetworkManager: Socket.IO + WebRTC
├── interpolator.ts           SnapshotBuffer: interpolação de posições remotas
├── maps.ts                   Configurações de mapas (MapConfig)
├── physics-presets.ts        Presets de tuning (padrão, velocidade, drift, pesado)
├── engine-constants.ts       Constantes compartilhadas (collider, spawn, timestep)
├── sound-manager.ts          SoundManager singleton (Howler.js)
├── types.ts                  Tipos globais (Player, Controls, ItemType...)
└── cars.ts                   Registro de modelos de kart disponíveis

hooks/
├── use-race-state.ts         Estado da corrida: checkpoints, ranking, anti-cheat
├── use-item-system.ts        Sistema de itens: coleta, uso, colisão, rede
├── use-keyboard-controls.ts  Input de teclado (WASD + espaço + shift)
├── use-touch-controls.ts     Input analógico touch (joystick virtual)
├── use-countdown.ts          Contagem regressiva sincronizada
├── use-race-timer.ts         Cronômetro da corrida
└── useNetworkPrediction.ts   Predição + interpolação para o jogador local em online

server/
├── index.ts                  Servidor HTTP + Socket.IO standalone (porta 3001)
├── socket-logic.ts           Handlers de eventos: lobby, signaling WebRTC, relay
└── integrated.ts             Servidor integrado Next.js + Socket.IO (produção)
```

---

## Game Loop

O Nitro Rush usa `useFrame` do `@react-three/fiber`, que executa em sincronia com `requestAnimationFrame`. Não há servidor de tick — toda simulação ocorre no cliente.

```
requestAnimationFrame (browser)
    └── useFrame(state, delta)           ← R3F — chamado ~60x/s
         ├── delta clamp: Math.min(delta, MAX_DELTA=0.05s)
         ├── Fixed Timestep Accumulator (BotKart)
         │    accumulator += delta
         │    while (accumulator >= PHYSICS_TIMESTEP=1/60) {
         │        simulateAI(PHYSICS_TIMESTEP)
         │        accumulator -= PHYSICS_TIMESTEP
         │    }
         ├── Rapier step (automático pelo R3F plugin)
         ├── setLinvel() / setRotation() → Rapier WASM
         ├── Raycast para ground snapping
         └── onPositionUpdate() → use-race-state (20Hz, throttled)
```

**Por que não fixed timestep puro para o kart humano?**
Karts humanos usam `setLinvel` (controle cinemático), não `applyForce`. O Rapier já executa seu próprio timestep interno. O `useFrame` apenas instrui o Rapier qual velocidade aplicar. Para arcade racer sem replay/rollback, `dt` scaling é adequado.

---

## Física (Rapier WASM)

### Configuração do mundo

```tsx
<Physics gravity={[0, -30, 0]} timeStep="vary">
  {/* todos os RigidBody */}
</Physics>
```

- Gravidade aumentada (`-30`) para sensação mais pesada de kart
- `timeStep="vary"` — Rapier usa o dt real do frame (controlado por R3F)

### Configuração do collider do kart

```ts
// engine-constants.ts
COLLIDER_HALF_EXTENTS: [0.5, 0.3, 0.8]  // x=largura, y=altura, z=comprimento
COLLIDER_OFFSET: [0, 0.3, 0]            // centro ligeiramente acima da base
```

```tsx
<RigidBody
  type="dynamic"
  mass={preset.mass}          // 280–420 kg dependendo do preset
  lockRotations               // rotação controlada manualmente via setRotation
  linearDamping={0}           // sem damping — controlamos velocidade diretamente
  friction={0}                // sem fricção — velocidade é setada, não forçada
  restitution={0}             // sem bounce em colisões
  ccd                         // Continuous Collision Detection para alta velocidade
>
  <CuboidCollider args={COLLIDER_HALF_EXTENTS} position={COLLIDER_OFFSET} />
</RigidBody>
```

### Estratégia de controle de velocidade

O kart usa **controle cinemático** via `setLinvel()` — a velocidade é calculada explicitamente a cada frame e injetada no Rapier. Rapier resolve colisões, e o resultado pós-colisão é lido de volta para o código.

Isso é diferente de usar `applyForce()` / `applyImpulse()`, que seria mais fisicamente correto mas muito mais difícil de tunar para feel de arcade.

```ts
// A cada frame:
body.setLinvel({ x: vx, y: verticalVel, z: vz }, true)

// Detecção de colisão com paredes: comparar speed do Rapier com speed setada no frame anterior
if (rapierMag < prevSetSpeed * 0.85) {
    // Colisão detectada — usar velocidade pós-colisão do Rapier
    vx = rapierLinvel.x
    vz = rapierLinvel.z
}
prevSetSpeed = currentMag
```

### Ground snapping (BotKart)

Bots usam raycast para detectar o chão e `setTranslation` para manter a altura:

```ts
// Raycast downward
const hit = world.castRay(ray, GROUND_RAY_RANGE=4.0, true, ...)
const groundY = hit ? origin.y - hit.timeOfImpact : null

// Spring para altura alvo
const targetY = groundY + HOVER_HEIGHT=0.1
const diff = targetY - body.y

if (diff > SNAP_THRESHOLD=0.5 || spinTimer > 0 || diff < -3.0) {
    body.setTranslation({ y: targetY }, true)  // snap imediato
} else if (diff < -0.02) {
    vy = Math.min(rapierVy, -gravity * dt * 4)   // gravidade para descer
} else if (diff > HEIGHT_DEADBAND=0.05) {
    vy = diff * SPRING_STIFFNESS=10.0             // spring proporcional
}

// Filtro anti-voo: anular vy positivo espúrio de colisões kart-kart
if (rapierVy > 1.5 && diff < 3.0) {
    vy = Math.min(0, vy)
}
```

---

## Kart do Jogador (KartPro)

`components/game/KartPro.tsx` — Gerencia input, física e estado do kart humano.

### Pipeline de frame

```
useFrame(state, delta):
    1. Ler controles (teclado/touch/gamepad)
    2. Chamar kart-physics-core.ts com controls + dt
       └── Retorna novo estado (speed, rotation, drift tier, boost...)
    3. Calcular velocidade linear (vx, vz) a partir do estado
    4. Detectar colisão com paredes (comparar vs prevSetSpeed)
    5. Calcular velocidade vertical (smoothedY, micro-bounce filter)
    6. body.setLinvel({ vx, vy, vz })
    7. body.setRotation(quaternion)
    8. onKartTransformChange() → FollowCamera (todo frame)
    9. onPositionUpdate() → use-race-state (throttled 20Hz)
```

### kart-physics-core.ts

Módulo puro TypeScript sem dependências R3F. Recebe `KartPhysicsState` + `Controls` + `dt` e retorna novo estado. Isso permite:
- Testar a física sem renderização
- Reutilizar em modo online (predição client-side)
- Separar concerns: KartPro apenas aplica o resultado ao Rapier

Funcionalidades do core:
- Aceleração / frenagem / ré
- Curva com `steerSmoothing`
- Sistema de drift (lock de direção, slide lateral, temporizadores de tier)
- Sistema de boost (boostStrength + boostTimeRemaining)
- Star power, oil slip, spin-out
- Speed clamp com boost

### Drift

```
DRIFT_BOOST_Tiers: [0.8, 1.5, 2.5]   // segundos para cada tier
DRIFT_BOOST_SPEEDS: [1.3, 1.5, 1.8]   // multiplicador de velocidade máxima
DRIFT_BOOST_DURATION: [0.8, 1.2, 1.8] // duração do boost em segundos
DRIFT_SLIDE_FACTOR: 0.15               // componente lateral no drift
```

Ao iniciar drift (espaço + curva), a direção do kart é "locked". O kart desliza lateralmente via componente perpendicular à velocidade. Ao soltar, o tier acumulado determina o boost.

---

## Kart dos Bots (BotKart)

`components/game/BotKart.tsx` — IA que navega pela pista usando waypoints.

### Pipeline de IA

```
useFrame:
    accumulator += delta (capped at 0.1s)
    while (accumulator >= PHYSICS_TIMESTEP):
        1. Encontrar próximo waypoint
        2. Calcular ângulo para o waypoint
        3. Girar em direção → currentRotation
        4. Acelerar até effectiveMaxSpeed
        5. Decrementar timers (boost, spin, star)

    Física visual (por frame):
        6. Raycast ground (throttled a cada 3 frames)
        7. Calcular verticalVel com spring/snap
        8. Filtrar vy de colisões (anti-voo)
        9. Detectar colisão com paredes
       10. body.setLinvel() + body.setRotation()
       11. onPositionUpdate() → use-race-state (throttled)
```

### Waypoints adaptativos

Para pistas com `pathPoints` explícitos (como o oval), o raio de captura do waypoint é calculado dinamicamente:

```ts
const spacing = wp0.distanceTo(wp1)
const adaptiveRadius = Math.min(20, Math.max(4, spacing * 0.4))
```

Isso evita que o bot "pule" waypoints em pistas com segmentos longos.

### Efeitos de itens em bots

| Método | Efeito |
|---|---|
| `applyBoost(strength, duration)` | `boostStrength` + `boostTimer` |
| `applyStarPower(duration)` | `starPowerTimer` → invencibilidade + velocidade máxima |
| `applyOilSlip(duration)` | `spinTimer = duration`, `speed *= 0.3` |
| `spinOut()` | `spinTimer = 1.2s`, `speed = 0` |

---

## Sistema de Câmera

`components/game/FollowCamera.tsx` — Câmera suave em terceira pessoa.

```ts
// Suavização independente por eixo (exponential decay)
const LAMBDA_XZ = 8.0    // camera position XZ
const LAMBDA_Y  = 1.5    // camera position Y (mais lento = mais estável)

// A cada frame:
position.x += (target.x - position.x) * (1 - Math.exp(-LAMBDA_XZ * dt))
position.y += (target.y - position.y) * (1 - Math.exp(-LAMBDA_Y * dt))

// FollowCamera recebe transform todo frame via onKartTransformChange
// (chamado ANTES do throttle de onPositionUpdate para garantir câmera fluida)
```

---

## Classificação e Lap Progress

### Spline Projection

Em vez de medir distância a waypoints (que oscila perto da linha de chegada), o progresso na volta é calculado projetando a posição do kart no spline `CatmullRomCurve3` da pista:

```ts
// track-path.ts — TrackSpline
class TrackSpline {
    // 256 pontos igualmente espaçados na curva (lookup table)
    // Busca local ±8 segmentos em torno do prevT → O(1) amortizado

    project(x, z, prevT): number  // retorna [0, 1) calibrado
}
```

**Calibração de startT:** O ponto de spawn é projetado no spline na inicialização, e esse offset é subtraído de todas as projeções futuras. Isso garante que `progress=0.0` corresponde sempre à linha de largada/chegada.

### Proteção monotônica do lapProgress

Colisões laterais com outros karts empurram o kart para a borda da pista, fazendo a projeção no spline recuar levemente (ex: `0.52 → 0.49`). Isso causava o jogador cair no ranking momentaneamente.

```ts
function updateMonotonicProgress(newProgress, prev, maxRef):
    const circFwd = (newProgress - prev + 1) % 1  // distância circular para frente

    if (circFwd > 0.3):
        // Cruzamento de volta legítimo (0.99 → 0.01) — aceita e reseta max
        maxRef = newProgress
        return newProgress

    if (newProgress >= prev):
        // Avanço normal — atualiza max
        maxRef = max(maxRef, newProgress)
        return newProgress

    const regression = prev - newProgress
    if (regression < 0.05):
        // Regressão espúria pequena (colisão) — mantém o max recente
        return max(maxRef, newProgress)

    // Regressão grande (reverso intencional) — aceita
    maxRef = newProgress
    return newProgress
```

### Sistema de checkpoints (anti-cheat)

```
Checkpoints: 0 → 1 (>25%) → 2 (>60%) → 3 (>85%) → Finish (crossing 0.9→0.1)

Guards:
- MIN_CHECKPOINT_SPEED = 2.0 m/s — parado não avança checkpoint
- MIN_DISTANCE_FOR_CHECKPOINT = 30m — evita teleporte contar como progresso
- else-if cascade — máximo 1 checkpoint por update (evita cascade por jitter)
- Penalidade reverso: cp cai se lapProgress recuar abaixo do threshold
```

### Ranking com hysteresis

O sort do ranking roda a 20Hz. Para evitar flicker de `1º → 4º → 1º` por oscilação de 1 tick:

```ts
// pendingPositionRef: Map<id, newPosition>
// Posição só é aplicada se confirmada em 2 ticks consecutivos (100ms)

if (lastPending === newPos) {
    s.position = newPos   // confirma
    pending.delete(id)
} else if (newPos !== s.position) {
    pending.set(id, newPos)  // guarda para o próximo tick
}
```

---

## Sistema de Pistas

### ModelTrack (pistas GLB)

Pistas baseadas em modelo GLB carregam a geometria do arquivo e geram colisores automaticamente por convenção de nomenclatura de mesh:

| Prefixo do mesh | Colisor gerado |
|---|---|
| `wall*` | RigidBody estático + TrimeshCollider |
| `barriers*` | RigidBody estático + TrimeshCollider |
| `prop_cone*` | RigidBody estático + TrimeshCollider |
| `1TARMAC*` | Não gera colisor (apenas visual da pista) |

O método `extractMeshDataFromNode` bake a world matrix + scale em `Float32Array` antes de criar o colisor, garantindo compatibilidade com modelos comprimidos (KHR_mesh_quantization).

### Pistas procedurais

Para pistas geradas por código (`oval`, `circuit`, `figure8`, `complex`), o `Track.tsx` despacha para `SplineTrack` que gera geometria Three.js e colisores `CuboidCollider` nas bordas.

---

## Constantes de Física

```ts
// engine-constants.ts — compartilhado entre KartPro e BotKart
MAX_DELTA = 0.05s              // Clamp do dt para evitar spiral of death
POSITION_UPDATE_INTERVAL = 0.05s  // 20Hz — taxa de report de posição
PHYSICS_TIMESTEP = 1/60s       // Fixed timestep do accumulator dos bots
SPAWN_Y_OFFSET = 0.0           // Offset Y ao spawnar

COLLIDER_HALF_EXTENTS = [0.5, 0.3, 0.8]  // Largura/2, Altura/2, Comprimento/2
COLLIDER_OFFSET = [0, 0.3, 0]            // Centro do collider (acima da base)
KART_MODEL_OFFSET = [0, 0.15, 0]         // Offset visual do modelo 3D
```

---

## Presets de Física

```ts
// physics-presets.ts
PRESET_STANDARD = {
    maxSpeed: 40, acceleration: 8, brakeForce: 35,
    drag: 3, reverseSpeedRatio: 0.4,
    turnSpeed: 1.8, minTurnSpeed: 0.3,
    driftSpeedThreshold: 8, driftSlideFactor: 0.15,
    driftBoostTiers: [0.8, 1.5, 2.5],
    driftBoostSpeeds: [1.3, 1.5, 1.8],
    driftBoostDuration: [0.8, 1.2, 1.8],
    mass: 350
}

PRESET_SPEED   // maxSpeed: 45, acceleration: 9, mass: 280
PRESET_DRIFT   // maxSpeed: 38, driftSlideFactor: 0.20, turnSpeed: 2.2
PRESET_HEAVY   // maxSpeed: 42, acceleration: 6, mass: 420
```

---

## Áudio

`lib/game/sound-manager.ts` — Singleton `SoundManager` usando Howler.js.

### Engine sound

```ts
// Pitch (rate) e volume modulados por velocidade
// Throttled: atualiza apenas se mudança > 0.05 (evita Howler spam)
rate = 0.8 + (speed / maxSpeed) * 1.2
volume = 0.3 + (speed / maxSpeed) * 0.7
```

### Lazy loading de SFX

Sons de efeito são carregados apenas no primeiro `play()`, não no mount. Isso reduz o tempo de carregamento inicial.

### Spatial audio

`SpatialEngineSound.tsx` usa posição 3D de karts remotos para calcular volume e pan com base na distância ao jogador local.

---

## Decisões de Design

### Por que `setLinvel` ao invés de `applyForce`?

`applyForce` / `applyImpulse` acumulam e interagem com o solver do Rapier de forma não-determinística com `useFrame`. `setLinvel` dá controle total sobre a velocidade, permitindo feel de arcade preciso e detecção de colisão simplificada.

### Por que não fixed timestep para o kart humano?

Karts usam controle cinemático — não há simulação de força acumulada que precisaria de timestep fixo para ser determinística. Para replay ou modo competitivo, seria necessário. Para arcade P2P casual, não é necessário.

### Por que WebRTC e não somente Socket.IO?

Socket.IO passa por servidor. Para corridas com 8 jogadores enviando posição a 20Hz, o servidor seria bottleneck e adicionaria latência. WebRTC P2P é UDP-like (unreliable/unordered), ideal para dados de posição onde frames antigos são descartados.

### Por que Rapier ao invés de Cannon/Ammo?

Rapier tem binding WASM mais moderno, melhor performance, suporte nativo a CCD (Continuous Collision Detection) e integração oficial com `@react-three/rapier`.

### Por que `lockRotations` no kart?

Sem `lockRotations`, colisões laterais com paredes fazem o kart tombar. A rotação é controlada manualmente via `body.setRotation(quaternion)` para garantir que o kart sempre aponte na direção de movimento.
