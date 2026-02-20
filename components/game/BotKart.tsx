import { useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier } from "@react-three/rapier";
import type { MapConfig } from "@/lib/game/maps";
import { generateTrackPoints, TrackSpline } from "@/lib/game/track-path";
import { CarModel } from "./CarModel";
import type { KartRef } from "./KartPro";
import { KartDriftSmoke, getRearWheelPositions } from "./KartEffects";
import { PlayerNameTag } from "./PlayerNameTag";
import { COLLIDER_HALF_EXTENTS, COLLIDER_OFFSET, MAX_DELTA, POSITION_UPDATE_INTERVAL, SPAWN_Y_OFFSET, PHYSICS_TIMESTEP } from "@/lib/game/engine-constants";
import { KART_PRESETS, PRESET_STANDARD, type KartPhysicsConfig, type KartPresetId } from "@/lib/game/physics-presets";

// ── Constants ───────────────────────────────────────────────────────

const FALLBACK_CIRCLE_SEGMENTS = 32;
const FALLBACK_CIRCLE_RADIUS = 50;
const GROUND_RAY_OFFSET = 1.0;
const GROUND_RAY_RANGE = 4.0;
const HOVER_HEIGHT = 0.1;
const SPRING_STIFFNESS = 10.0;
const SNAP_THRESHOLD = 0.5;
const HEIGHT_DEADBAND = 0.05;
const GRAVITY = 9.8;
const SPIN_SPEED = 15;
// [Fix 4.9] Align bot spin duration with human SPIN_OUT_DURATION (kart-physics-core.ts:32)
const SPIN_DURATION = 1.2;
const MAX_VERTICAL_SPEED = 15;
const VELOCITY_CLAMP_FACTOR = 1.2;

const DIFFICULTY_MULTIPLIERS = {
  easy: { speed: 0.85, accel: 0.9, turn: 1.0, waypointRadius: 8 },
  medium: { speed: 1.0, accel: 1.0, turn: 1.05, waypointRadius: 6 },
  hard: { speed: 1.1, accel: 1.15, turn: 1.15, waypointRadius: 4 },
} as const;

// ── Types ───────────────────────────────────────────────────────────

const BOT_DRIFT_ANGLE_THRESHOLD = 0.3; // ~17° de ângulo de curva para considerar drift

interface BotKartProps {
  id: string;
  playerName?: string;
  isHost?: boolean; // Added prop
  position: [number, number, number];
  initialRotation?: number;
  modelUrl?: string;
  modelScale?: number;
  color: string;
  map: MapConfig;
  difficulty: "easy" | "medium" | "hard";
  raceStarted: boolean;
  physicsPreset?: KartPresetId | KartPhysicsConfig;
  onPositionUpdate?: (
    id: string,
    position: [number, number, number],
    rotation: number,
    speed: number,
    lapProgress: number
  ) => void;
  onEffectsUpdate?: (effects: { isDrifting: boolean; isBoosting: boolean }) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────

function getTrackPath(map: MapConfig): THREE.Vector3[] {
  return generateTrackPoints(map, 64).map(([x, z]) => new THREE.Vector3(x, 0.5, z));
}

function generateWaypoints(map: MapConfig, count: number): THREE.Vector3[] {
  // Para mapas com pathPoints explícitos (ex: cartoon oval), usar os pontos
  // diretamente sem reinterpolação — a CatmullRom suaviza demais nas curvas
  // e faz os bots saírem da pista nas extremidades.
  if (map.pathPoints && map.pathPoints.length >= 4) {
    return map.pathPoints.map(([x, z]) => new THREE.Vector3(x, 0.5, z));
  }

  // Para pistas procedurais (sem pathPoints): gerar via CatmullRom
  let basePath = getTrackPath(map);
  if (!basePath || basePath.length < 2) {
    basePath = [];
    for (let i = 0; i < FALLBACK_CIRCLE_SEGMENTS; i++) {
      const angle = (i / FALLBACK_CIRCLE_SEGMENTS) * Math.PI * 2;
      basePath.push(new THREE.Vector3(Math.cos(angle) * FALLBACK_CIRCLE_RADIUS, 0, Math.sin(angle) * FALLBACK_CIRCLE_RADIUS));
    }
  }
  const curve = new THREE.CatmullRomCurve3(basePath, true);
  return curve.getSpacedPoints(count);
}

function clampLinvel(v: { x: number; y: number; z: number }, limit: number) {
  // Clamp horizontal speed only (XZ plane) — vertical is managed separately
  const hMag = Math.sqrt(v.x * v.x + v.z * v.z);
  let x = v.x, z = v.z;
  if (hMag > limit && hMag > 0) {
    const s = limit / hMag;
    x *= s;
    z *= s;
  }
  return { x, y: v.y, z };
}

// ── Component ───────────────────────────────────────────────────────

export const BotKart = forwardRef<KartRef, BotKartProps>(function BotKart({
  id,
  isHost,
  playerName,
  position,
  initialRotation = 0,
  modelUrl = "/assets/cars/coupe.glb",
  modelScale = 0.6,
  map,
  difficulty,
  raceStarted,
  physicsPreset,
  onPositionUpdate,
  onEffectsUpdate,
}, ref) {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const groupRef = useRef<THREE.Group>(null);

  const currentRotation = useRef(initialRotation);
  const currentSpeed = useRef(0);
  const currentWaypointIndex = useRef(0);
  const lapProgress = useRef(0);
  const waypointsRef = useRef<THREE.Vector3[]>([]);
  const trackSplineRef = useRef<TrackSpline | null>(null);
  const adaptiveWaypointRadius = useRef(0); // Calculado após generateWaypoints
  const spinTimer = useRef(0);
  const starPowerTimer = useRef(0); // [Fix 4.7] Invencibilidade durante star power
  const boostTimer = useRef(0);     // [Fix 4.6] Boost duration timer (seconds remaining)
  const boostStrength = useRef(1);  // [Fix 4.6] Current boost multiplier for max speed
  const steeringValRef = useRef(0);
  const isDrifting = useRef(false);
  const slipRatio = useRef(0);
  const lastUpdateTime = useRef(0);
  const rayFrameCount = useRef(0);
  const cachedGroundY = useRef<number | null>(null);

  // Reusable objects to avoid GC pressure in useFrame (~7 bots × 60fps = 420 allocations/s saved)
  const _quat = useRef(new THREE.Quaternion());
  const _yAxis = useRef(new THREE.Vector3(0, 1, 0));
  const _forward = useRef(new THREE.Vector3());
  const _direction = useRef(new THREE.Vector3());
  const _currentPos = useRef(new THREE.Vector3());
  const lastGroundSample = useRef(0);
  const prevSetSpeed = useRef(0);
  const maxLapProgress = useRef(0); // Monotonic guard — lapProgress nunca regride

  const preset = useMemo<KartPhysicsConfig>(() => {
    if (!physicsPreset) return PRESET_STANDARD;
    if (typeof physicsPreset === "string") return KART_PRESETS[physicsPreset] ?? PRESET_STANDARD;
    return physicsPreset;
  }, [physicsPreset]);

  const settings = useMemo(() => {
    const mult = DIFFICULTY_MULTIPLIERS[difficulty];
    return {
      maxSpeed: preset.maxSpeed * mult.speed,
      acceleration: preset.acceleration * mult.accel,
      turnSpeed: preset.turnSpeed * mult.turn,
      waypointRadius: mult.waypointRadius,
      drag: preset.drag,
      driftSpeedThreshold: preset.driftSpeedThreshold,
      mass: preset.mass,
    };
  }, [difficulty, preset]);

  useImperativeHandle(ref, () => ({
    getPosition: () => {
      if (!rigidBodyRef.current) return [0, 0, 0];
      const t = rigidBodyRef.current.translation();
      return [t.x, t.y, t.z];
    },
    getRotation: () => currentRotation.current,
    getLinvel: () => {
      if (!rigidBodyRef.current) return null;
      const v = rigidBodyRef.current.linvel();
      return { x: v.x, y: v.y, z: v.z };
    },
    getGroup: () => groupRef.current,
    applyBoost: (strength = 1.5, duration = 2) => {
      // [Fix 4.6] Apply boost with proper timer — mirrors coreApplyBoost in kart-physics-core.ts
      boostStrength.current = strength;
      boostTimer.current = duration;
      currentSpeed.current = Math.min(currentSpeed.current * strength, settings.maxSpeed * strength);
    },
    applyStarPower: (duration = 8) => {
      // [Fix 4.7] Bots get speed boost + invincibility during star power
      currentSpeed.current = settings.maxSpeed;
      starPowerTimer.current = duration;
    },
    getIsInvincible: () => starPowerTimer.current > 0,
    applyOilSlip: (duration = 2.5) => {
      // [Fix 4.7] Oil causes spin-out only if not invincible (star power)
      if (starPowerTimer.current > 0) return;
      if (spinTimer.current <= 0) {
        spinTimer.current = duration;
        currentSpeed.current *= 0.3;
      }
    },
    spinOut: () => {
      // [Fix 4.7] Shell/banana spin-out blocked by star power invincibility
      if (starPowerTimer.current > 0) return;
      if (spinTimer.current <= 0) {
        spinTimer.current = SPIN_DURATION;
        currentSpeed.current = 0;
      }
    },
  }));

  useEffect(() => {
    waypointsRef.current = generateWaypoints(map, Math.max(80, (map.pathPoints?.length ?? 0) * 2));
    trackSplineRef.current = new TrackSpline(map);

    // Calcular raio adaptativo baseado no espaçamento real entre waypoints
    // Para pistas com pathPoints (ex: oval ~30m/waypoint), o raio fixo de 4-8m
    // é muito pequeno — os bots passam pelo waypoint sem capturar
    if (waypointsRef.current.length >= 2) {
      const wp0 = waypointsRef.current[0];
      const wp1 = waypointsRef.current[1];
      const spacing = wp0.distanceTo(wp1);
      // Raio = 40% do espaçamento, mínimo de 4m, máximo de 20m
      const adaptiveRadius = Math.min(20, Math.max(4, spacing * 0.4));
      // Patch temporário: override settings.waypointRadius via mutable ref
      adaptiveWaypointRadius.current = adaptiveRadius;
    }

    if (waypointsRef.current.length > 0) {
      const startP = new THREE.Vector3(position[0], position[1], position[2]);
      let closest = 0;
      let minD = Infinity;
      waypointsRef.current.forEach((wp, i) => {
        const d = startP.distanceTo(wp);
        if (d < minD) { minD = d; closest = i; }
      });
      currentWaypointIndex.current = closest;
    }
  }, [map, position]);

  const { world, rapier } = useRapier();

  // Cached ray object — reused every frame to avoid GC pressure (~60 allocations/s saved per bot)
  const rayRef = useRef<InstanceType<typeof rapier.Ray> | null>(null);
  const getRay = () => {
    if (!rayRef.current) rayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    return rayRef.current;
  };

  const accumulator = useRef(0);

  useFrame((_state, delta) => {
    const body = rigidBodyRef.current;
    if (!body) return;

    // Pre-race: hold kart in place on the grid (prevent falling/floating)
    // Same approach as KartPro: allow gentle gravity settling, kill horizontal drift
    if (!raceStarted || waypointsRef.current.length === 0) {
      if (!raceStarted) {
        const vel = body.linvel();
        // Allow gentle gravity settling but clamp to prevent launch/tunneling
        const clampedVy = Math.max(vel.y, -5);
        body.setLinvel({ x: 0, y: clampedVy, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Keep rotation locked to start direction
        _quat.current.setFromAxisAngle(_yAxis.current, currentRotation.current);
        body.setRotation(_quat.current, true);
      }
      steeringValRef.current = 0;
      return;
    }

    // Ler posição atual do Rapier UMA VEZ por frame, antes do loop de física
    // Isso garante que a IA navega com a posição real do frame atual
    {
      const t = body.translation();
      _currentPos.current.set(t.x, t.y, t.z);
    }

    // Fixed Timestep Accumulator
    // Clamp delta to 0.1s to prevent spiral of death during massive lag spikes
    accumulator.current += Math.min(delta, 0.1);

    // Safety break loop count
    let steps = 0;
    while (accumulator.current >= PHYSICS_TIMESTEP && steps < 10) {
      steps++;
      accumulator.current -= PHYSICS_TIMESTEP;
      const step = PHYSICS_TIMESTEP;

      const pos = _currentPos.current;

      // Logic Update:
      const waypoints = waypointsRef.current;
      if (waypoints.length > 0) {
        // Waypoint switching — usa raio adaptativo se calculado, senão usa o do preset
        const effectiveRadius = adaptiveWaypointRadius.current > 0
          ? adaptiveWaypointRadius.current
          : settings.waypointRadius;
        const distToTarget = pos.distanceTo(waypoints[currentWaypointIndex.current]);
        if (distToTarget < effectiveRadius) {
          currentWaypointIndex.current = (currentWaypointIndex.current + 1) % waypoints.length;
        }

        // Direction to next waypoint
        const nextWp = waypoints[currentWaypointIndex.current];
        _direction.current.subVectors(nextWp, pos);
        _direction.current.y = 0;
        _direction.current.normalize();

        const targetAngle = Math.atan2(_direction.current.x, _direction.current.z);

        let angleDiff = targetAngle - currentRotation.current;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const turnAmount = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), settings.turnSpeed * step);

        // Compute normalized steering for visual wheel rotation
        const maxTurnPerFrame = settings.turnSpeed * step;
        steeringValRef.current = maxTurnPerFrame > 0 ? -(turnAmount / maxTurnPerFrame) : 0;

        // [Fix 4.7] Decrement star power timer each frame
        if (starPowerTimer.current > 0) {
          starPowerTimer.current -= step;
          if (starPowerTimer.current < 0) starPowerTimer.current = 0;
        }

        // [Fix 4.6] Decrement boost timer — reset strength when expired
        if (boostTimer.current > 0) {
          boostTimer.current -= step;
          if (boostTimer.current <= 0) {
            boostTimer.current = 0;
            boostStrength.current = 1;
          }
        }

        if (spinTimer.current > 0) {
          currentRotation.current += SPIN_SPEED * step;
          spinTimer.current -= step;
          currentSpeed.current = 0;
          steeringValRef.current = 0;
        } else {
          currentRotation.current += turnAmount;
          // [Fix 4.6] Use boostStrength for max speed cap during active boost
          const effectiveMaxSpeed = settings.maxSpeed * boostStrength.current;
          if (currentSpeed.current < effectiveMaxSpeed) {
            currentSpeed.current += settings.acceleration * step;
          }
          if (Math.abs(currentSpeed.current) > 0) {
            const dragSign = Math.sign(currentSpeed.current);
            currentSpeed.current = Math.max(0, Math.abs(currentSpeed.current) - settings.drag * step) * dragSign;
          }
        }

        // Drift logic update
        isDrifting.current =
          Math.abs(angleDiff) > BOT_DRIFT_ANGLE_THRESHOLD &&
          currentSpeed.current > settings.driftSpeedThreshold &&
          spinTimer.current <= 0;
      }
    }

    // --- Render Frame Logic (Visuals & Raycasts) ---
    // Posição já lida acima (antes do loop de física) — só relê para ter t.x/t.y/t.z
    const t = body.translation();
    if (!Number.isFinite(t.x)) { body.setLinvel({ x: 0, y: 0, z: 0 }, true); return; }

    // Ground snapping via raycast (throttled)
    rayFrameCount.current++;
    const shouldCast = rayFrameCount.current % 3 === 0;
    const nowMs = performance.now();
    if (nowMs - lastGroundSample.current > 200) cachedGroundY.current = null;

    if (shouldCast) {
      const ray = getRay();
      ray.origin = { x: t.x, y: t.y + GROUND_RAY_OFFSET, z: t.z };
      const hit = world.castRay(ray, GROUND_RAY_RANGE, true, undefined, undefined, undefined, body);
      cachedGroundY.current = hit ? t.y + GROUND_RAY_OFFSET - hit.timeOfImpact : null;
      lastGroundSample.current = nowMs;
    }

    // Velocidade vertical: ler do Rapier mas ignorar impulsos positivos espúrios
    // (colisões laterais com paredes/rampas, kart-kart e sensores de item
    //  podem injetar vy positivo que faz o bot voar)
    const rapierLinvel = body.linvel();
    const rapierVy = rapierLinvel.y;

    let verticalVel: number;

    if (cachedGroundY.current !== null) {
      const targetY = cachedGroundY.current + HOVER_HEIGHT;
      const diff = targetY - t.y;

      // Snap imediato: bot muito abaixo do chão OU em spinOut/oilSlip
      // (velocidade=0 durante spin — sem snap, o spring fraco deixa o bot flutuar)
      // Snap de emergência: bot voou muito acima (colisão kart-kart) — trazer de volta
      if (diff > SNAP_THRESHOLD || spinTimer.current > 0 || diff < -3.0) {
        body.setTranslation({ x: t.x, y: targetY, z: t.z }, true);
        verticalVel = 0;
      } else if (diff < -0.02) {
        // Bot acima do alvo: aplicar gravidade para descer (não usar vy do Rapier
        // que pode ser positivo por colisão)
        verticalVel = Math.min(rapierVy, -GRAVITY * PHYSICS_TIMESTEP * 4);
      } else if (diff > HEIGHT_DEADBAND) {
        // Bot ligeiramente abaixo: spring proporcional à diferença, usando timestep fixo
        verticalVel = diff * SPRING_STIFFNESS;
      } else {
        // Dentro da deadband: zerar velocidade vertical para parar oscilação
        verticalVel = 0;
      }

      // Anular impulsos de colisão para cima quando o bot está perto do chão.
      // diff < 3.0: cobre colisões kart-kart mesmo em terreno irregular.
      // rapierVy > 1.5: threshold baixo para pegar até colisões rasas entre bots.
      if (rapierVy > 1.5 && diff < 3.0) {
        verticalVel = Math.min(0, verticalVel);
      }
    } else {
      // Sem chão detectado: gravidade real.
      // Se estiver em spin (cachedGroundY expirou por throttle), não deixar vy positivo
      // — evita flutuar no ar durante spinOut/oilSlip quando o raycast não achou chão.
      if (spinTimer.current > 0) {
        verticalVel = Math.min(0, rapierVy);
      } else {
        verticalVel = rapierVy - GRAVITY * Math.min(delta, 0.1);
      }
    }

    verticalVel = Math.max(Math.min(verticalVel, MAX_VERTICAL_SPEED), -MAX_VERTICAL_SPEED);

    // Apply Final State to RigidBody
    _quat.current.setFromAxisAngle(_yAxis.current, currentRotation.current);
    body.setRotation(_quat.current, true);

    _forward.current.set(0, 0, 1).applyQuaternion(_quat.current);
    let vx = _forward.current.x * currentSpeed.current;
    let vz = _forward.current.z * currentSpeed.current;

    // Wall/kart collision: compare against LAST FRAME's set speed
    // (rapierLinvel já lido acima — reutilizar para evitar segunda chamada WASM)
    const currentV = rapierLinvel;
    const rapierSqXZ = currentV.x * currentV.x + currentV.z * currentV.z;
    const lastSet = prevSetSpeed.current;

    if (rapierSqXZ > 0.25 && lastSet > 1) {
      const rapierMag = Math.sqrt(rapierSqXZ);

      if (rapierMag < lastSet * 0.85) {
        const fwd = _forward.current;
        const rapierDirX = currentV.x / rapierMag;
        const rapierDirZ = currentV.z / rapierMag;
        const rapierForwardDot = rapierDirX * fwd.x + rapierDirZ * fwd.z;
        if (rapierForwardDot > 0) {
          vx = currentV.x;
          vz = currentV.z;
        } else {
          vx = 0;
          vz = 0;
        }
        const actualSpeed = Math.sqrt(vx * vx + vz * vz);
        currentSpeed.current = actualSpeed;
      }
    }

    prevSetSpeed.current = Math.sqrt(vx * vx + vz * vz);
    // [Fix 4.6] Clamp respects active boost strength so boosted bots aren't capped prematurely
    const safeVel = clampLinvel({ x: vx, y: verticalVel, z: vz }, settings.maxSpeed * boostStrength.current * VELOCITY_CLAMP_FACTOR);
    body.setLinvel(safeVel, true);

    slipRatio.current = isDrifting.current
      ? Math.min(currentSpeed.current / settings.maxSpeed, 1)
      : 0;

    onEffectsUpdate?.({ isDrifting: isDrifting.current, isBoosting: false });

    // Report position based on Clock (robust against frame rate)
    const elapsed = _state.clock.getElapsedTime();
    if (onPositionUpdate && elapsed - lastUpdateTime.current >= POSITION_UPDATE_INTERVAL) {
      lastUpdateTime.current = elapsed;
      if (trackSplineRef.current) {
        const newProgress = trackSplineRef.current.project(t.x, t.z, lapProgress.current);
        // Proteção monotônica: não permite regressão espúria pequena (colisão lateral).
        // Cruzamento de volta legítimo (0.98→0.02) tem circFwd > 0.3 → aceito normalmente.
        // Jitter grande do spline (circularDelta ≥ 0.5) → descartado.
        const rawDelta = Math.abs(newProgress - lapProgress.current);
        const circularDelta = Math.min(rawDelta, 1 - rawDelta);
        if (circularDelta >= 0.5) {
          // Jitter extremo — descarta
        } else {
          const fwd = newProgress - lapProgress.current;
          const circFwd = fwd < 0 ? fwd + 1 : fwd;
          if (circFwd > 0.3) {
            // Cruzamento de volta — reset do máximo
            maxLapProgress.current = newProgress;
            lapProgress.current = newProgress;
          } else if (newProgress >= lapProgress.current) {
            // Avanço normal
            if (newProgress > maxLapProgress.current) maxLapProgress.current = newProgress;
            lapProgress.current = newProgress;
          } else {
            // Regressão — só aceita se for grande (reverso intencional)
            const regression = lapProgress.current - newProgress;
            if (regression < 0.05) {
              lapProgress.current = maxLapProgress.current > newProgress ? maxLapProgress.current : newProgress;
            } else {
              maxLapProgress.current = newProgress;
              lapProgress.current = newProgress;
            }
          }
        }
      }
      onPositionUpdate(id, [t.x, t.y, t.z], currentRotation.current, currentSpeed.current, lapProgress.current);
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      name={id}
      position={[position[0], position[1] + SPAWN_Y_OFFSET, position[2]]}
      rotation={[0, initialRotation, 0]}
      type="dynamic"
      mass={settings.mass}
      colliders={false}
      lockRotations
      linearDamping={0}
      angularDamping={0}
      ccd
      canSleep={false}
      friction={0}
      restitution={0}
    >
      <CuboidCollider
        args={COLLIDER_HALF_EXTENTS}
        position={COLLIDER_OFFSET}
        friction={0}
        restitution={0}
      />
      <group ref={groupRef}>
        <CarModel url={modelUrl} scale={modelScale} steeringRef={steeringValRef} />
        <KartDriftSmoke
          slipRatioRef={slipRatio}
          rearWheelPositions={getRearWheelPositions(modelUrl)}
        />
        {playerName && <PlayerNameTag name={playerName} />}
      </group>
    </RigidBody>
  );
});
