"use client";

import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { KartRef } from "./KartPro";

// ── Skid Marks (instanced flat quads on the ground) ─────────────────

export function SkidMarks({
    kartRef,
    effectsRef,
    rearWheelOffsets,
}: {
    kartRef: React.RefObject<KartRef | null>;
    effectsRef: React.RefObject<{ isDrifting: boolean; isBoosting: boolean } | null>;
    rearWheelOffsets?: [[number, number, number], [number, number, number]];
}) {
    const count = 500;
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const indexRef = useRef(0);
    const lastPosRef = useRef(new THREE.Vector3());
    const placedRef = useRef(false);

    const offsets = rearWheelOffsets ?? [[-0.65, 0.02, -1.0], [0.65, 0.02, -1.0]];

    // Ref callback: initializes all instance matrices synchronously before first render frame
    const hiddenMatrix = useMemo(() => {
        const obj = new THREE.Object3D();
        obj.position.set(0, -9999, 0);
        obj.scale.set(0, 0, 0);
        obj.updateMatrix();
        return obj.matrix.clone();
    }, []);

    const setMeshRef = useCallback((mesh: THREE.InstancedMesh | null) => {
        meshRef.current = mesh;
        if (mesh) {
            for (let i = 0; i < count; i++) {
                mesh.setMatrixAt(i, hiddenMatrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
        }
    }, [hiddenMatrix, count]);

    const worldPos = useMemo(() => new THREE.Vector3(), []);
    const worldQuat = useMemo(() => new THREE.Quaternion(), []);
    const _euler = useMemo(() => new THREE.Euler(), []);

    // Reusable vectors to avoid per-frame allocation
    const leftOffsetVec = useMemo(() => new THREE.Vector3(), []);
    const rightOffsetVec = useMemo(() => new THREE.Vector3(), []);

    useFrame(() => {
        const isDrifting = effectsRef.current?.isDrifting;

        // ★ EARLY EXIT: skip getWorldPosition/Quaternion when not drifting (saves ~0.5ms × 8 karts)
        if (!isDrifting) {
            placedRef.current = false;
            return;
        }

        const group = kartRef.current?.getGroup();
        if (!meshRef.current || !group) return;

        // Use world position (group.position is local [0,0,0] inside RigidBody)
        group.getWorldPosition(worldPos);
        const dist = worldPos.distanceTo(lastPosRef.current);
        const minGap = 0.3;

        if (dist > minGap) {
            placedRef.current = true;
            lastPosRef.current.copy(worldPos);

            // Extract world Y rotation from the parent chain
            group.getWorldQuaternion(worldQuat);
            _euler.setFromQuaternion(worldQuat, 'YXZ');
            const yaw = _euler.y;

            // Transform local offsets to world space (reuse vectors)
            leftOffsetVec.set(offsets[0][0], offsets[0][1], offsets[0][2]);
            rightOffsetVec.set(offsets[1][0], offsets[1][1], offsets[1][2]);

            leftOffsetVec.applyMatrix4(group.matrixWorld);
            rightOffsetVec.applyMatrix4(group.matrixWorld);

            // Elevate Y slightly above ground to prevent z-fighting
            leftOffsetVec.y = worldPos.y + 0.05;
            rightOffsetVec.y = worldPos.y + 0.05;

            dummy.position.copy(leftOffsetVec);
            dummy.rotation.set(-Math.PI / 2, 0, yaw);
            dummy.scale.set(0.35, 0.8, 1);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(indexRef.current, dummy.matrix);
            indexRef.current = (indexRef.current + 1) % count;

            dummy.position.copy(rightOffsetVec);
            dummy.rotation.set(-Math.PI / 2, 0, yaw);
            dummy.scale.set(0.35, 0.8, 1);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(indexRef.current, dummy.matrix);
            indexRef.current = (indexRef.current + 1) % count;

            meshRef.current.instanceMatrix.needsUpdate = true;
        }
    });

    return (
        <instancedMesh ref={setMeshRef} args={[undefined, undefined, count]} frustumCulled={false} renderOrder={1}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
                color="#1a1a1a"
                transparent
                opacity={0.55}
                side={THREE.DoubleSide}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-4}
                polygonOffsetUnits={-4}
            />
        </instancedMesh>
    );
}

// ── Tire Smoke Emitter (world-space simulation) ─────────────────────

const SMOKE_MAX = 80;
const SMOKE_EMIT_RATE = 4;
const SMOKE_RISE = 2.0;
const SMOKE_SPREAD = 0.25;
const SMOKE_LIFE = 0.6;
const SMOKE_SIZE_MIN = 0.15;
const SMOKE_SIZE_MAX = 0.7;

function TireSmokeEmitter({ slipRatioRef, position }: {
    slipRatioRef: React.RefObject<number>;
    position: [number, number, number];
}) {
    const pointsRef = useRef<THREE.Points>(null);
    const emitAccum = useRef(0);
    const aliveRef = useRef(0);

    const state = useMemo(() => ({
        ages: new Float32Array(SMOKE_MAX).fill(SMOKE_LIFE + 1),
        // World-space positions & velocities (simulation)
        wx: new Float32Array(SMOKE_MAX),
        wy: new Float32Array(SMOKE_MAX),
        wz: new Float32Array(SMOKE_MAX),
        vx: new Float32Array(SMOKE_MAX),
        vy: new Float32Array(SMOKE_MAX),
        vz: new Float32Array(SMOKE_MAX),
    }), []);

    const geometry = useMemo(() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE_MAX * 3), 3));
        geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(SMOKE_MAX), 1));
        geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(SMOKE_MAX), 1));
        return geo;
    }, []);

    const emitPos = useMemo(() => new THREE.Vector3(), []);
    const invMat = useMemo(() => new THREE.Matrix4(), []);
    const lastWorldMat = useMemo(() => new THREE.Matrix4(), []);
    const tmpVec = useMemo(() => new THREE.Vector3(), []);

    const material = useMemo(
        () =>
            new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
                uniforms: {
                    uColor: { value: new THREE.Color(0.82, 0.80, 0.76) },
                },
                vertexShader: /* glsl */ `
                    attribute float alpha;
                    attribute float aSize;
                    varying float vAlpha;
                    void main() {
                        vAlpha = alpha;
                        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = aSize * (150.0 / -mvPos.z);
                        gl_Position = projectionMatrix * mvPos;
                    }
                `,
                fragmentShader: /* glsl */ `
                    uniform vec3 uColor;
                    varying float vAlpha;
                    void main() {
                        float d = length(gl_PointCoord - vec2(0.5));
                        if (d > 0.5) discard;
                        float softEdge = 1.0 - smoothstep(0.1, 0.5, d);
                        gl_FragColor = vec4(uColor, vAlpha * softEdge);
                    }
                `,
            }),
        []
    );

    useFrame((_s, delta) => {
        const pts = pointsRef.current;
        if (!pts) return;

        const slip = slipRatioRef.current ?? 0;

        // ★ EARLY EXIT: no particles alive and nothing to emit → skip entire update
        if (aliveRef.current === 0 && slip <= 0.1) return;

        const dt = Math.min(delta, 0.05);
        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
        const alphaAttr = geometry.getAttribute('alpha') as THREE.BufferAttribute;
        const sizeAttr = geometry.getAttribute('aSize') as THREE.BufferAttribute;
        const localPos = posAttr.array as Float32Array;
        const alphas = alphaAttr.array as Float32Array;
        const sizes = sizeAttr.array as Float32Array;
        const { ages, wx, wy, wz, vx, vy, vz } = state;

        // ── Emit at emitter world position ──
        pts.getWorldPosition(emitPos);

        if (slip > 0.1) {
            emitAccum.current += SMOKE_EMIT_RATE * slip * dt * 60;
            while (emitAccum.current >= 1) {
                emitAccum.current -= 1;
                let slot = -1;
                for (let i = 0; i < SMOKE_MAX; i++) {
                    if (ages[i] > SMOKE_LIFE) { slot = i; break; }
                }
                if (slot === -1) break;

                wx[slot] = emitPos.x + (Math.random() - 0.5) * 0.1;
                wy[slot] = emitPos.y + 0.15 + Math.random() * 0.1;
                wz[slot] = emitPos.z + (Math.random() - 0.5) * 0.1;

                vx[slot] = (Math.random() - 0.5) * SMOKE_SPREAD;
                vy[slot] = SMOKE_RISE * (0.7 + Math.random() * 0.3);
                vz[slot] = (Math.random() - 0.5) * SMOKE_SPREAD;

                ages[slot] = 0;
            }
        }

        // ── Update in world space + count alive ──
        let alive = 0;
        for (let i = 0; i < SMOKE_MAX; i++) {
            if (ages[i] > SMOKE_LIFE) {
                alphas[i] = 0;
                sizes[i] = 0;
                continue;
            }

            alive++;
            ages[i] += dt;
            const t = ages[i] / SMOKE_LIFE;

            wx[i] += vx[i] * dt;
            wy[i] += vy[i] * dt;
            wz[i] += vz[i] * dt;

            vx[i] *= (1 - 2.0 * dt);
            vy[i] *= (1 - 0.8 * dt);
            vz[i] *= (1 - 2.0 * dt);

            sizes[i] = SMOKE_SIZE_MIN + t * (SMOKE_SIZE_MAX - SMOKE_SIZE_MIN);

            if (t < 0.1) {
                alphas[i] = (t / 0.1) * 0.5 * slip;
            } else {
                const f = 1 - (t - 0.1) / 0.9;
                alphas[i] = f * f * 0.5 * slip;
            }
        }
        aliveRef.current = alive;

        // ── Convert world -> local for GPU buffer (cache inverse until world matrix changes) ──
        if (!lastWorldMat.equals(pts.matrixWorld)) {
            lastWorldMat.copy(pts.matrixWorld);
            invMat.copy(pts.matrixWorld).invert();
        }

        for (let i = 0; i < SMOKE_MAX; i++) {
            const i3 = i * 3;
            if (ages[i] <= SMOKE_LIFE) {
                tmpVec.set(wx[i], wy[i], wz[i]);
                tmpVec.applyMatrix4(invMat);
                localPos[i3]     = tmpVec.x;
                localPos[i3 + 1] = tmpVec.y;
                localPos[i3 + 2] = tmpVec.z;
            } else {
                localPos[i3]     = 0;
                localPos[i3 + 1] = -999;
                localPos[i3 + 2] = 0;
            }
        }

        posAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
    });

    return (
        <group position={position}>
            <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
        </group>
    );
}

// ── Per-model rear wheel positions (in group-local space) ────────────
// Derived from GLB bounding-box inspection:
//   go_kart: rear structure at X≈±53, Z≈-60 (model units) × scale 0.025
//   kaykit (rally/coupe/etc): rear axle at X≈±0.65, Z≈-1.0 (scale 0.6)
const REAR_WHEEL_POSITIONS: Record<string, [[number, number, number], [number, number, number]]> = {
    "go_kart.glb": [[-1.33, 0.0, -1.50], [1.33, 0.0, -1.50]],
};

const DEFAULT_REAR_WHEELS: [[number, number, number], [number, number, number]] = [
    [-0.65, 0.0, -1.0],
    [0.65, 0.0, -1.0],
];

export function getRearWheelPositions(modelUrl?: string): [[number, number, number], [number, number, number]] {
    if (!modelUrl) return DEFAULT_REAR_WHEELS;
    for (const key of Object.keys(REAR_WHEEL_POSITIONS)) {
        if (modelUrl.includes(key)) return REAR_WHEEL_POSITIONS[key];
    }
    return DEFAULT_REAR_WHEELS;
}

// ── Combined Kart Drift Smoke ────────────────────────────────────────

export function KartDriftSmoke({
    slipRatioRef,
    rearWheelPositions = DEFAULT_REAR_WHEELS,
}: {
    slipRatioRef: React.RefObject<number>;
    rearWheelPositions?: [[number, number, number], [number, number, number]];
}) {
    return (
        <>
            <TireSmokeEmitter
                slipRatioRef={slipRatioRef}
                position={rearWheelPositions[0]}
            />
            <TireSmokeEmitter
                slipRatioRef={slipRatioRef}
                position={rearWheelPositions[1]}
            />
        </>
    );
}
