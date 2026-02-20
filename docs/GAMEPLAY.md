# Sistemas de Jogo — Gameplay

Este documento descreve em detalhe os sistemas de jogo do Nitro Rush: física do kart, drift, itens, IA dos bots e a pipeline de uma corrida.

---

## Sumário

- [Física do Kart](#física-do-kart)
- [Sistema de Drift](#sistema-de-drift)
- [Sistema de Itens](#sistema-de-itens)
- [IA dos Bots](#ia-dos-bots)
- [Pipeline de uma Corrida](#pipeline-de-uma-corrida)
- [HUD e Feedback Visual](#hud-e-feedback-visual)
- [Sistema de Áudio](#sistema-de-áudio)
- [Controles Mobile](#controles-mobile)
- [Adicionando Novos Mapas](#adicionando-novos-mapas)
- [Adicionando Novos Karts](#adicionando-novos-karts)

---

## Física do Kart

### Presets disponíveis

| Preset | Vel. Máx | Aceleração | Drift | Ideal para |
|---|---|---|---|---|
| `standard` | 40 | 8 | Médio | Jogadores novos |
| `speed` | 45 | 9 | Baixo | Pistas longas e retas |
| `drift` | 38 | 9.5 | Alto | Pistas com curvas |
| `heavy` | 42 | 6 | Baixo | Impulso pós-boost |

Para definir o preset de um kart:

```tsx
<KartPro physicsPreset="drift" ... />
<BotKart physicsPreset="speed" ... />
```

Ou passar um objeto customizado:

```tsx
<KartPro physicsPreset={{ maxSpeed: 50, acceleration: 10, ... }} ... />
```

### Parâmetros de física

```ts
interface KartPhysicsConfig {
    maxSpeed: number              // Velocidade máxima em m/s
    acceleration: number          // Taxa de aceleração (m/s²)
    brakeForce: number            // Força de frenagem (m/s²)
    drag: number                  // Resistência ao rolamento (m/s²)
    reverseSpeedRatio: number     // Velocidade máxima em ré (% do maxSpeed)

    turnSpeed: number             // Velocidade angular máxima (rad/s)
    minTurnSpeed: number          // Velocidade mínima para girar
    speedFactorDivisor: number    // Reduz curva em alta velocidade
    steerSmoothing: number        // Suavização do steering (0-1)

    driftSpeedThreshold: number   // Velocidade mínima para drift
    driftTurnBonus: number        // Bônus de curva durante drift
    driftSlideFactor: number      // Componente lateral no drift

    driftBoostTiers: [n1, n2, n3]     // Tempo (s) para cada tier
    driftBoostSpeeds: [m1, m2, m3]    // Multiplicador de velocidade máxima
    driftBoostDuration: [d1, d2, d3]  // Duração do boost (s)

    mass: number                  // Massa para física de colisão (kg)
}
```

### Colisão com paredes

O sistema detecta colisão com paredes comparando a velocidade que o Rapier devolveu com a velocidade que foi setada no frame anterior:

```
Se rapierSpeed < prevSetSpeed * 0.85:
    → Colisão detectada
    → Usar velocidade pós-colisão do Rapier (ele já calculou o wall-slide)
    → Atualizar state.speed = velocidade atual (para re-aceleração progressiva)
```

Isso garante que ao bater em uma parede e sair, o kart acelera progressivamente a partir da velocidade real — não "explode" com velocidade acumulada.

---

## Sistema de Drift

### Iniciando o drift

1. Pressione `Espaço` + `A` ou `D` enquanto acima da `driftSpeedThreshold` (8 m/s padrão)
2. A direção do kart é "locked" no ângulo do momento
3. O kart começa a deslizar lateralmente (`driftSlideFactor`)

### Acumulando mini-turbo

Durante o drift, um timer acumula. O indicador visual muda de cor:

| Tempo | Tier | Cor do indicador |
|---|---|---|
| 0–0.8s | Nenhum | — |
| 0.8s+ | Mini-Turbo 1 | Azul |
| 1.5s+ | Mini-Turbo 2 | Laranja |
| 2.5s+ | Mini-Turbo 3 | Roxo/Rosa |

### Liberando o boost

Solte `Espaço`. O tier acumulado determina o boost:

| Tier | Multiplicador | Duração |
|---|---|---|
| Mini-Turbo 1 | 1.3× velocidade máxima | 0.8s |
| Mini-Turbo 2 | 1.5× velocidade máxima | 1.2s |
| Mini-Turbo 3 | 1.8× velocidade máxima | 1.8s |

### Nota sobre velocidade durante drift

Como no Mario Kart original, **a velocidade não é reduzida durante o drift**. O kart mantém a velocidade e adiciona uma componente lateral de slide.

---

## Sistema de Itens

### Caixas de item

Espalhadas pela pista em posições configuradas em `MapConfig.itemBoxPositions`. Ao colidir, a caixa desaparece e reaparece após 5 segundos.

### Distribuição por posição

A probabilidade de cada item é ponderada pela posição na corrida:

| Posição | Itens mais prováveis |
|---|---|
| 1º lugar | Banana (40%), Óleo (30%), Cogumelo (20%) |
| Posições intermediárias | Cogumelo (30%), Concha (20%), Banana (20%), Óleo (20%) |
| Último lugar | Estrela (40%), Cogumelo (30%), Concha (30%) |

### Itens disponíveis

#### Cogumelo (🍄)
- Boost de **2× velocidade** por **2 segundos**
- Uso: pressione `Shift`
- Efeito em bots: `bot.applyBoost(2.0, 2.0)`

#### Banana (🍌)
- Dropa uma casca **atrás do kart** ao usar
- Permanece na pista até ser atingida
- Causa **spin-out** em quem pisar
- Distância de drop: 4m atrás do kart

#### Concha Vermelha (🚀)
- Projétil teleguiado que mira o adversário mais próximo
- Voa em arco e persegue o alvo
- Causa **spin-out** ao acertar
- Pode ser destruída por outro projétil

#### Estrela (⭐)
- **Invencibilidade** por 8 segundos
- **Velocidade máxima** imediata
- Imune a bananas, óleos e conchas durante o efeito
- Efeito visual: kart brilhante

#### Óleo (⚫)
- Dropa uma **poça de óleo** atrás do kart
- Quem passar pela poça sofre **derrapagem** por 2.5 segundos
- Poça persiste na pista (não desaparece ao ser atingida, cooldown de 2s por kart)
- Distância de drop: 4m atrás do kart

### Colisão de itens

O sistema usa dois mecanismos de detecção em paralelo:

1. **Sensor Rapier** — `onIntersectionEnter` no collider do item
2. **Verificação por proximidade** — `ItemCollisionChecker` verifica distância a cada 3 frames

Um mecanismo de **deduplicação por 600ms** garante que o mesmo hit não seja processado duas vezes se ambos dispararem ao mesmo tempo.

---

## IA dos Bots

### Navegação

Os bots seguem uma sequência de **waypoints** gerados a partir do `pathPoints` do mapa. O waypoint atual é considerado "capturado" quando o bot entra no raio adaptativo:

```ts
const spacing = wp[i].distanceTo(wp[i+1])
const radius = clamp(spacing * 0.4, 4, 20)  // 40% do espaçamento, entre 4m e 20m
```

### Pathfinding

A cada tick do fixed timestep (60Hz):

1. Calcula vetor do bot para o próximo waypoint
2. Calcula `angleDiff` para a direção desejada
3. Gira no máximo `turnSpeed * dt` por tick
4. Acelera até `effectiveMaxSpeed`
5. Se `spinTimer > 0`: gira 15 rad/s sem mover (animação de spin-out)

### Drift dos bots

Bots entram em drift quando:
- `|angleDiff| > 0.3 rad` (~17°)
- velocidade acima de `driftSpeedThreshold`
- não estão em spin-out

O drift dos bots é apenas visual (smoke + efeitos) — não há boost de drift para bots.

### Uso de itens

Bots coletam itens ao passar por caixas. Após uma **delay aleatória de 300–1000ms**, o bot usa o item automaticamente:

```ts
const delay = 300 + Math.random() * 700
setTimeout(() => useBotItem(botId, item), delay)
```

Bots podem usar: Cogumelo (boost), Banana (dropar), Óleo (dropar), Concha Vermelha (lançar), Estrela (ativar).

### Ground snapping

Bots usam raycast downward (a cada 3 frames, com cache de 200ms) para detectar o chão e se manter colados a superfícies irregulares. Isso é necessário porque bots usam `setLinvel` e não "sentem" o chão naturalmente como um corpo com gravidade pura.

---

## Pipeline de uma Corrida

### 1. Lobby / Setup

- Host escolhe mapa, número de voltas e dificuldade dos bots
- Online: jogadores entram pela sala com o código

### 2. Spawn na grade

Posições definidas em `MapConfig.startPositions`. Karts são posicionados em fileiras de 2. Antes da largada, `setLinvel` mantém os karts parados com gravidade suave.

### 3. Countdown

```
3... 2... 1... GO!
```

- `use-countdown.ts` gerencia o timer
- Sons: `countdown_beep.ogg` para 3/2/1, `countdown_go.ogg` para GO
- `raceStarted = false` durante countdown — karts não se movem

### 4. Corrida

- Karts movem-se livremente
- Checkpoints avançam conforme `lapProgress`
- Posições calculadas a 20Hz por `totalProgress = (lap - 1) + lapProgress`
- Itens coletáveis nas ItemBoxes

### 5. Final de volta

Ao cruzar a linha de chegada (`lapProgress: 0.9 → 0.1`) com os 3 checkpoints marcados e velocidade mínima:

```ts
if (checkpoints === 3 && prevProgress > 0.9 && lapProgress < 0.1) {
    newLap = lap + 1
    checkpoints = 0
}
```

### 6. Chegada

Ao completar todas as voltas com distância mínima acumulada (`100m × totalLaps`):

- `state.finished = true`
- `state.finishTime = raceTimeRef.current`
- Som `race_finish.ogg` ou `victory.ogg` para o 1º lugar
- O jogador ainda controla o kart mas não avança no ranking

### 7. Tela de resultado

Após todos chegarem (ou timeout), exibe o ranking final com tempos. Host pode iniciar Rematch.

---

## HUD e Feedback Visual

### Indicadores na tela

| Elemento | Posição | Informação |
|---|---|---|
| Lap counter | Topo centro | `volta/totalVoltas` |
| Cronômetro | Topo centro | `MM:SS.ms` |
| Posição | Topo centro | `posição/total` |
| Placar | Topo esquerda | Lista de corredores por posição |
| Minimapa | Topo direita | Posição de todos na pista |
| Item slot | Baixo direita | Item atual com emoji |
| Velocímetro | Baixo direita | Velocidade em KM/H |
| Controles | Baixo esquerda | WASD, SPACE, SHIFT (desktop) |

### Speedometer

O velocímetro exibe velocidade em KM/H (velocidade Rapier × fator de conversão). Quando em boost:

- **Anel laranja** em vez de branco
- Ponteiro pode ultrapassar o máximo base (40 → até 80 com boost 1.8×)

### Item slot

Ao coletar um item, aparece com animação `zoom-in`. Ao usar, desaparece com `zoom-out`. Emojis por item:

```
🍄 = mushroom
🍌 = banana
🚀 = red_shell
⭐ = star
⚫ = oil
```

---

## Sistema de Áudio

### Sons do kart

| Arquivo | Evento |
|---|---|
| `engine-revving.ogg` | Loop contínuo, pitch por velocidade |
| `drift.ogg` | Loop durante drift |
| `boost.ogg` | Ao ativar boost/mushroom/star |
| `spin_out.ogg` | Ao sofrer spin-out |
| `banana_hit.ogg` | Ao bater em banana |

### Sons de jogo

| Arquivo | Evento |
|---|---|
| `item_collect.ogg` | Ao coletar item box |
| `lap_complete.ogg` | Ao completar uma volta |
| `race_finish.ogg` | Ao completar a corrida (2º+) |
| `victory.ogg` | Ao chegar em 1º |
| `countdown_beep.ogg` | 3, 2, 1 |
| `countdown_go.ogg` | GO! |

### Sons de UI

| Arquivo | Evento |
|---|---|
| `ui_click.ogg` | Clique em botões |
| `ui_hover.ogg` | Hover em opções |

### Música

3 faixas de intro que tocam aleatoriamente no menu:
- `music_intro.mp3`
- `music_intro_2.mp3`
- `music_intro_3.mp3`

---

## Controles Mobile

`components/game/MobileControls.tsx`

### Layout

```
┌─────────────────────────────────────────────────┐
│  [Speed + Item]                                  │
│                                                  │
│                                                  │
│  ┌──────────┐                    ┌─────┐ ┌─────┐ │
│  │ Joystick │                    │ DFT │ │ ITM │ │
│  │ Analógico│                    │     │ │     │ │
│  └──────────┘                    └─────┘ └─────┘ │
│                                                  │
│                              [Gas / Brake Slider]│
└─────────────────────────────────────────────────┘
```

### Analógico

- Joystick esquerdo: direção (steerX) + aceleração/freio (throttleY)
- Botão direito superior: Drift
- Botão direito inferior: Usar item

O joystick envia valores contínuos (`steerX: -1 a +1`, `throttleY: -1 a +1`) que o `KartPro` interpreta para steering e throttle analógicos.

---

## Adicionando Novos Mapas

### 1. Pista procedural

```ts
// lib/game/maps.ts
const myMap: MapConfig = {
    id: "my-circuit",
    name: "My Circuit",
    description: "Uma pista customizada",
    difficulty: "medium",
    trackType: "circuit",    // oval | circuit | figure8 | complex
    trackWidth: 20,
    trackLength: 200,
    curveRadius: 60,
    startPositions: [
        [0, 0.5, -10], [3, 0.5, -10], [-3, 0.5, -10],
        [0, 0.5, -15], [3, 0.5, -15], [-3, 0.5, -15],
    ],
    // ... outras propriedades
}
```

### 2. Pista baseada em modelo GLB

```ts
const myModelMap: MapConfig = {
    id: "my-model-track",
    name: "Model Track",
    modelUrl: "/assets/kart-map/my-track/track.glb",
    modelScale: 1.0,
    trackMeshName: "TARMAC",    // mesh do asfalto (visual only, sem collider)
    pathPoints: [               // waypoints para IA e spline
        [0, -120], [60, -80], [80, 0], [60, 80], [0, 120],
        [-60, 80], [-80, 0], [-60, -80],
    ],
    startPositions: [...],
    itemBoxPositions: [
        [30, 0.5, 0], [-30, 0.5, 0], [0, 0.5, 60],
    ],
}
```

### 3. Convenção de nomenclatura de meshes (ModelTrack)

Para colisores automáticos, nomeie os meshes no Blender/editor com os prefixos:

- `wall_*` — paredes laterais
- `barriers_*` — barreiras
- `prop_cone_*` — cones e props

Meshes sem esses prefixos são apenas visuais.

---

## Adicionando Novos Karts

### 1. Adicionar o modelo GLB

Coloque em `public/assets/cars/meu_kart.glb`.

### 2. Registrar em cars.ts

```ts
// lib/game/cars.ts
export const AVAILABLE_CARS = [
    { id: "standard", url: "/assets/cars/kart.glb", name: "Kart Padrão", scale: 1.0 },
    { id: "coupe",    url: "/assets/cars/coupe.glb", name: "Coupe", scale: 0.6 },
    { id: "meu-kart", url: "/assets/cars/meu_kart.glb", name: "Meu Kart", scale: 0.8 },
]
```

### 3. Configurar posição das rodas traseiras (fumaça de drift)

```ts
// components/game/KartEffects.tsx — getRearWheelPositions()
if (modelUrl.includes("meu_kart")) {
    return [[-0.6, 0.15, -0.9], [0.6, 0.15, -0.9]]  // [esquerda, direita]
}
```

As posições são relativas ao centro do kart. Ajuste Y e Z para coincidir com as rodas traseiras do modelo.

### 4. Selecionar no lobby

O jogador pode selecionar o kart no lobby. A prop `modelUrl` é passada ao `KartPro` e `BotKart`.
