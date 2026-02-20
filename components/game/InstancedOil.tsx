"use client";
import React, { useImperativeHandle, forwardRef, useRef, useCallback, useEffect } from "react";
import { CuboidCollider, RigidBody, RapierRigidBody, type IntersectionEnterPayload } from "@react-three/rapier";
import * as THREE from "three";

const MAX_OIL_SPILLS = 10; // Reduced from 20 — saves 10 RigidBodies in Rapier WASM heap
const INACTIVE_Y = -999;
const COOLDOWN_MS = 2000; // Oil persists — prevent same kart retriggering for 2s
const OWNER_IMMUNITY_MS = 1500; // Owner can't hit their own oil for 1.5s after dropping

// ── Shared geometry & material (Flyweight — created once, reused by all oil puddles) ──
let _oilGeo: THREE.CylinderGeometry | null = null;
let _oilMat: THREE.MeshStandardMaterial | null = null;

function getOilShared() {
    if (!_oilGeo) {
        _oilGeo = new THREE.CylinderGeometry(2.0, 2.0, 0.1, 16); // 16 segments (was 32)
        _oilMat = new THREE.MeshStandardMaterial({
            color: "#050505",
            roughness: 0.1,
            metalness: 0.9,
            transparent: true,
            opacity: 0.9,
        });
    }
    return { geo: _oilGeo!, mat: _oilMat! };
}

export interface OilPoolRef {
    spawn: (position: [number, number, number], ownerId?: string) => void;
    despawn: (id: string) => void;
    getActiveOils: () => Array<{ id: string; position: [number, number, number]; ownerId: string; spawnTime: number }>;
    getSnapshot: () => any[];
    restoreSnapshot: (items: any[]) => void;
}

interface OilPoolProps {
    onCollide: (oilId: string, kartId: string) => void;
}

// ── Individual Oil Puddle (physics body + sensor) ────────────────────
// Uses RigidBody ref + setTranslation for reliable position updates.
// The `position` prop on RigidBody only applies at mount time in Rapier.
const OilItem = React.memo(({ id, isActive, position, ownerId, spawnTime, onCollide }: {
    id: string;
    isActive: boolean;
    position: [number, number, number];
    ownerId: string;
    spawnTime: number;
    onCollide: (kartId: string) => void;
}) => {
    const rigidBodyRef = useRef<RapierRigidBody>(null);
    const lastHitRef = useRef<Record<string, number>>({}); // Per-kart cooldown

    // Move the RigidBody whenever pool state changes (spawn/despawn)
    useEffect(() => {
        const body = rigidBodyRef.current;
        if (!body) return;

        if (isActive) {
            body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
            body.setEnabled(true);
            // Clear previous hit records when respawned at new location
            lastHitRef.current = {};
        } else {
            body.setTranslation({ x: 0, y: INACTIVE_Y, z: 0 }, true);
            body.setEnabled(false);
        }
    }, [isActive, position]);

    const handleIntersection = useCallback((payload: IntersectionEnterPayload) => {
        if (!isActive) return;

        const kartId = payload.other.rigidBodyObject?.name || "unknown_kart";
        // Ignore collisions with other items
        if (kartId.startsWith("banana_") || kartId.startsWith("oil_")) return;

        // Owner immunity: dropper can't hit their own oil for OWNER_IMMUNITY_MS
        if (kartId === ownerId && performance.now() - spawnTime < OWNER_IMMUNITY_MS) return;

        // Per-kart cooldown — oil persists so same kart shouldn't retrigger constantly
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
            name={`oil_${id}`}
        >
            {/* Dark oil puddle visual — shared geometry & material (Flyweight) */}
            <mesh receiveShadow position={[0, 0.05, 0]}
                geometry={getOilShared().geo} material={getOilShared().mat} />

            {/* Sensor collider — onIntersectionEnter requires parent RigidBody */}
            <CuboidCollider
                args={[1.5, 0.5, 1.5]}
                position={[0, 0.3, 0]}
                sensor
                onIntersectionEnter={handleIntersection}
            />
        </RigidBody>
    );
});

OilItem.displayName = "OilItem";

// ── Pool State ───────────────────────────────────────────────────────
interface OilSlot {
    id: string;
    active: boolean;
    position: [number, number, number];
    ownerId: string;
    spawnTime: number;
}

// ── OilPool (object pool with imperative spawn/despawn) ──────────────
export const OilPool = forwardRef<OilPoolRef, OilPoolProps>(({ onCollide }, ref) => {
    const poolRef = useRef<OilSlot[]>(
        Array.from({ length: MAX_OIL_SPILLS }, (_, i) => ({
            id: `oil_pool_${i}`,
            active: false,
            position: [0, 0, 0] as [number, number, number],
            ownerId: "",
            spawnTime: 0,
        }))
    );
    const [, forceUpdate] = React.useState(0);

    useImperativeHandle(ref, () => ({
        spawn: (position, ownerId = "") => {
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

            // Create NEW position array to trigger useEffect dependency change
            const slot = pool[index];
            slot.active = true;
            slot.position = [position[0], position[1], position[2]]; // NEW array, not mutation
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
        // Posições ativas para detecção por proximidade (ItemCollisionChecker)
        getActiveOils: () => {
            return poolRef.current
                .filter(p => p.active)
                .map(p => ({ id: p.id, position: p.position, ownerId: p.ownerId, spawnTime: p.spawnTime }));
        },
        getSnapshot: () => {
            return poolRef.current.filter(p => p.active).map(p => ({
                position: p.position,
                ownerId: p.ownerId
            }));
        },
        restoreSnapshot: (items: any[]) => {
            poolRef.current.forEach(p => p.active = false);
            items.forEach(item => {
                const pool = poolRef.current;
                const index = pool.findIndex(p => !p.active);
                if (index === -1) return;
                const slot = pool[index];
                slot.active = true;
                slot.position = item.position;
                slot.ownerId = item.ownerId;
                slot.spawnTime = performance.now();
            });
            forceUpdate(n => n + 1);
        }
    }));

    const handleCollide = useCallback((oilId: string, kartId: string) => {
        onCollide(oilId, kartId);
    }, [onCollide]);

    return (
        <>
            {poolRef.current.map(item => (
                <OilItem
                    key={item.id}
                    id={item.id}
                    isActive={item.active}
                    position={item.position}
                    ownerId={item.ownerId}
                    spawnTime={item.spawnTime}
                    onCollide={(kartId) => handleCollide(item.id, kartId)}
                />
            ))}
        </>
    );
});

OilPool.displayName = "OilPool";
