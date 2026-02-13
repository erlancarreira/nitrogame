"use client";

import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { KartRef } from "./KartPro";

interface ItemBoxProps {
    position: [number, number, number];
    allKarts: Array<{ id: string; ref: React.RefObject<KartRef> }>;
    onCollect: (collectorId: string) => void;
}

// ── Shared geometry & materials (Flyweight) ──────────────────────────
// Created once, reused by all ItemBox instances to minimize GPU memory.
let _sharedBoxGeo: THREE.BoxGeometry | null = null;
let _sharedInnerGeo: THREE.BoxGeometry | null = null;
let _sharedInnerMat: THREE.MeshBasicMaterial | null = null;
let _sharedOuterMat: THREE.MeshStandardMaterial | null = null;

function getSharedGeometries() {
    if (!_sharedBoxGeo) {
        _sharedBoxGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        _sharedInnerGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);

        // Question mark texture (canvas)
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.fillStyle = "rgba(255, 215, 0, 0.3)";
            ctx.fillRect(0, 0, 128, 128);
            ctx.font = "bold 100px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillText("?", 68, 68);
            ctx.fillStyle = "white";
            ctx.fillText("?", 64, 64);
        }
        _sharedInnerMat = new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            color: "white",
            side: THREE.DoubleSide,
        });
        _sharedOuterMat = new THREE.MeshStandardMaterial({
            transparent: true,
            opacity: 0.6,
            roughness: 0.0,
            metalness: 0.8,
        });
    }
    return {
        boxGeo: _sharedBoxGeo!,
        innerGeo: _sharedInnerGeo!,
        innerMat: _sharedInnerMat!,
        outerMat: _sharedOuterMat!,
    };
}

// ── ItemBox Component ────────────────────────────────────────────────
// Key performance changes vs. previous version:
// 1. Uses `visible` toggle instead of return null (no mount/unmount)
// 2. Cooldown tracked in refs, not React state (no re-renders)
// 3. Removed per-box pointLight (major GPU cost with 24+ boxes)
// 4. Shared geometry & inner material (Flyweight pattern)
// 5. Each box still gets its own outer material (needed for independent HSL color)
const COLLECT_DISTANCE_SQ = 4.0; // 2m radius
const RESPAWN_TIME = 3.0; // seconds

// Module-level stamp to ensure shared material HSL is updated only once per frame (not 24×)
let _lastHSLTime = -1;

const ItemBoxBase = ({ position, allKarts, onCollect }: ItemBoxProps) => {
    const groupRef = useRef<THREE.Group>(null);
    const boxRef = useRef<THREE.Mesh>(null);
    const activeRef = useRef(true);
    const cooldownRef = useRef(0);
    const frameCount = useRef(0);

    useFrame((state, delta) => {
        const group = groupRef.current;
        if (!group) return;

        if (activeRef.current) {
            // Spin + bob animation (every frame for smoothness)
            group.rotation.y += delta * 2;
            group.position.y = position[1] + Math.sin(state.clock.elapsedTime * 3) * 0.2;

            // Rainbow color on shared outer material — only first box per frame updates it
            if (_sharedOuterMat && state.clock.elapsedTime !== _lastHSLTime) {
                _lastHSLTime = state.clock.elapsedTime;
                const hue = (state.clock.elapsedTime * 0.5) % 1;
                _sharedOuterMat.color.setHSL(hue, 0.8, 0.5);
                _sharedOuterMat.emissive.setHSL(hue, 0.8, 0.2);
            }

            // Collision check against all karts (throttled: every 3 frames)
            // getPosition() crosses WASM bridge, 24 boxes × 8 karts = 192 WASM calls/frame
            frameCount.current++;
            if (frameCount.current % 3 === 0) {
                for (const kart of allKarts) {
                    const kartRef = kart.ref.current;
                    if (!kartRef) continue;

                    const kartPos = kartRef.getPosition();
                    const dx = kartPos[0] - position[0];
                    const dz = kartPos[2] - position[2];

                    if (dx * dx + dz * dz < COLLECT_DISTANCE_SQ) {
                        onCollect(kart.id);
                        activeRef.current = false;
                        cooldownRef.current = RESPAWN_TIME;
                        group.visible = false;
                        break;
                    }
                }
            }
        } else {
            // Cooldown (box is invisible, no animation cost)
            cooldownRef.current -= delta;
            if (cooldownRef.current <= 0) {
                activeRef.current = true;
                group.visible = true;
            }
        }
    });

    const { boxGeo, innerGeo, innerMat, outerMat } = getSharedGeometries();

    return (
        <group ref={groupRef} position={position}>
            {/* Glass Box (outer shell — rainbow animated, shared material) */}
            <mesh ref={boxRef} geometry={boxGeo} material={outerMat} />

            {/* Question Mark (inner — shared material) */}
            <mesh geometry={innerGeo} material={innerMat} />
        </group>
    );
};

export const ItemBox = React.memo(ItemBoxBase);
