"use client";
import React, { useImperativeHandle, forwardRef, useRef, useCallback, useEffect } from "react";
import { CuboidCollider, RigidBody, RapierRigidBody, type IntersectionEnterPayload } from "@react-three/rapier";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const MAX_BANANAS = 10; // Reduced from 20 — saves 10 RigidBodies in Rapier WASM heap
const INACTIVE_Y = -999;
const COOLDOWN_MS = 500; // Prevent same kart retriggering within 500ms
const OWNER_IMMUNITY_MS = 1500; // Owner can't hit their own banana for 1.5s after dropping
const BANANA_MODEL_URL = "/assets/items/banana_peel_mario_kart.glb";
const BANANA_SCALE = 0.002; // Model is ~500 units tall (cm scale), 0.003 → ~1.5m in-game

export interface BananaPoolRef {
    spawn: (position: [number, number, number], rotation: number, ownerId?: string) => void;
    despawn: (id: string) => void;
    getSnapshot: () => any[];
    restoreSnapshot: (items: any[]) => void;
}

interface BananaPoolProps {
    onCollide: (bananaId: string, kartId: string) => void;
}

// ── Individual Banana (physics body + sensor) ────────────────────────
// Uses RigidBody ref + setTranslation for reliable position updates.
// The `position` prop on RigidBody only applies at mount time in Rapier.
const BananaItem = React.memo(({ id, isActive, position, rotation, ownerId, spawnTime, onCollide }: {
    id: string;
    isActive: boolean;
    position: [number, number, number];
    rotation: [number, number, number];
    ownerId: string;
    spawnTime: number;
    onCollide: (kartId: string) => void;
}) => {
    const { scene } = useGLTF(BANANA_MODEL_URL);
    const rigidBodyRef = useRef<RapierRigidBody>(null);
    const lastHitRef = useRef<Record<string, number>>({}); // Per-kart cooldown
    // Clone scene once and reuse — avoids allocating a new clone every render
    const clonedScene = useRef<THREE.Object3D | null>(null);
    if (!clonedScene.current) clonedScene.current = scene.clone();

    // Move the RigidBody whenever pool state changes (spawn/despawn)
    useEffect(() => {
        const body = rigidBodyRef.current;
        if (!body) return;

        if (isActive) {
            body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
            body.setEnabled(true);
            lastHitRef.current = {};
        } else {
            body.setTranslation({ x: 0, y: INACTIVE_Y, z: 0 }, true);
            body.setEnabled(false);
            lastHitRef.current = {};
        }
    }, [isActive, position]);

    const handleIntersection = useCallback((payload: IntersectionEnterPayload) => {
        if (!isActive) return;

        const kartId = payload.other.rigidBodyObject?.name || "unknown_kart";
        // Ignore collisions with other items (banana/oil sensors)
        if (kartId.startsWith("banana_") || kartId.startsWith("oil_")) return;

        // Owner immunity: dropper can't hit their own banana for OWNER_IMMUNITY_MS
        if (kartId === ownerId && performance.now() - spawnTime < OWNER_IMMUNITY_MS) return;

        // Per-kart cooldown to prevent multi-fire from physics micro-oscillations
        const now = performance.now();
        if (lastHitRef.current[kartId] && now - lastHitRef.current[kartId] < COOLDOWN_MS) return;
        lastHitRef.current[kartId] = now;

        onCollide(kartId);
    }, [isActive, onCollide, ownerId, spawnTime]);

    return (
        <RigidBody
            ref={rigidBodyRef}
            type="fixed"
            colliders={false}
            position={[0, INACTIVE_Y, 0]}
            rotation={rotation}
            name={`banana_${id}`}
        >
            {/* Banana GLB model (cloned once per pool slot, reused across renders) */}
            <primitive object={clonedScene.current!} scale={BANANA_SCALE} position={[0, 0.3, 0]} />

            {/* Sensor collider — onIntersectionEnter requires parent RigidBody */}
            <CuboidCollider
                args={[0.6, 0.8, 0.6]}
                position={[0, 0.5, 0]}
                sensor
                onIntersectionEnter={handleIntersection}
            />
        </RigidBody>
    );
});

BananaItem.displayName = "BananaItem";

// ── Pool State ───────────────────────────────────────────────────────
interface BananaSlot {
    id: string;
    active: boolean;
    position: [number, number, number];
    rotation: [number, number, number];
    ownerId: string;
    spawnTime: number;
}

// ── BananaPool (object pool with imperative spawn/despawn) ───────────
export const BananaPool = forwardRef<BananaPoolRef, BananaPoolProps>(({ onCollide }, ref) => {
    // Use ref instead of state to avoid re-rendering the entire pool on every spawn/despawn.
    // Force update via a counter state.
    const poolRef = useRef<BananaSlot[]>(
        Array.from({ length: MAX_BANANAS }, (_, i) => ({
            id: `banana_pool_${i}`,
            active: false,
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            ownerId: "",
            spawnTime: 0,
        }))
    );
    const [, forceUpdate] = React.useState(0);

    useImperativeHandle(ref, () => ({
        spawn: (position, rotationY, ownerId = "") => {
            const pool = poolRef.current;
            let index = pool.findIndex(p => !p.active);

            if (index === -1) {
                // Pool full — recycle oldest based on spawnTime (true FIFO)
                let oldestIndex = 0;
                let oldestTime = pool[0].spawnTime;
                for (let i = 1; i < pool.length; i++) {
                    if (pool[i].spawnTime < oldestTime) {
                        oldestTime = pool[i].spawnTime;
                        oldestIndex = i;
                    }
                }
                index = oldestIndex;
            }

            // Create NEW arrays to trigger useEffect dependency change
            const slot = pool[index];
            slot.active = true;
            slot.position = [position[0], position[1], position[2]]; // NEW array, not mutation
            slot.rotation = [0, rotationY, 0]; // NEW array, not mutation
            slot.ownerId = ownerId;
            slot.spawnTime = performance.now();
            forceUpdate(n => n + 1);
        },
        despawn: (id) => {
            const slot = poolRef.current.find(p => p.id === id);
            if (slot) {
                slot.active = false;
                forceUpdate(n => n + 1);
            }
        },
        // State Replication
        getSnapshot: () => {
            return poolRef.current.filter(p => p.active).map(p => ({
                position: p.position,
                rotationY: p.rotation[1],
                ownerId: p.ownerId
            }));
        },
        restoreSnapshot: (items: any[]) => {
            // Clear current
            poolRef.current.forEach(p => p.active = false);
            // Spawn new
            items.forEach(item => {
                // Use spawn logic to populate
                const pool = poolRef.current;
                const index = pool.findIndex(p => !p.active);
                if (index === -1) return;
                const slot = pool[index];
                slot.active = true;
                slot.position = item.position;
                slot.rotation = [0, item.rotationY, 0];
                slot.ownerId = item.ownerId;
                slot.spawnTime = performance.now(); // Reset time, acceptable for simple sync
            });
            forceUpdate(n => n + 1);
        }
    }));

    // Stable callback refs per slot (avoid creating new functions each render)
    const handleCollide = useCallback((bananaId: string, kartId: string) => {
        onCollide(bananaId, kartId);
    }, [onCollide]);

    return (
        <>
            {poolRef.current.map(item => (
                <BananaItem
                    key={item.id}
                    id={item.id}
                    isActive={item.active}
                    position={item.position}
                    rotation={item.rotation}
                    ownerId={item.ownerId}
                    spawnTime={item.spawnTime}
                    onCollide={(kartId) => handleCollide(item.id, kartId)}
                />
            ))}
        </>
    );
});

BananaPool.displayName = "BananaPool";

// Preload banana model during module initialization
useGLTF.preload(BANANA_MODEL_URL);
