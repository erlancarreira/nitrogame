import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody } from '@react-three/rapier';
import { CarModel } from './CarModel';
import { PlayerNameTag } from './PlayerNameTag';
import * as THREE from 'three';

/**
 * Snapshot from a network POS message.
 * Each snapshot records server-time so we can interpolate between two of them.
 */
interface Snapshot {
    pos: THREE.Vector3;
    rot: number;           // Y-axis euler
    speed: number;
    time: number;          // performance.now() when received
}

export interface RemoteKartData {
    pos: [number, number, number];
    rot: number;
    speed: number;
    lapProgress: number;
    t: number;             // sender timestamp (performance.now on sender)
}

interface RemoteKartProps {
    id: string;
    playerName?: string;
    dataRef: React.RefObject<Record<string, RemoteKartData>>;
    initialPosition: [number, number, number];
    initialRotation: number;
    modelUrl: string;
    modelScale: number;
    color: string;
}

// ----- Constants -----

/** How far behind "now" we render, in seconds.
 *  This gives us a buffer to always have two snapshots to interpolate between.
 *  100ms = ~2 network ticks at 20Hz. Adds slight visual delay but eliminates jitter. */
const INTERPOLATION_DELAY = 0.1;

/** Maximum snapshots to keep in the buffer (ring buffer). */
const MAX_SNAPSHOTS = 20;

/** If we haven't received a snapshot for this long (seconds), start extrapolating. */
const EXTRAPOLATION_LIMIT = 0.3;

/** Snap distance threshold — if kart teleported more than this, snap instantly (respawn). */
const SNAP_DISTANCE = 30;

/**
 * RemoteKart — Renders a remote player's kart with professional network interpolation.
 *
 * Technique: **Snapshot Interpolation** (used in Rocket League, Overwatch, Fortnite)
 *
 * Instead of lerping toward the latest received position (which causes jitter when
 * packets arrive at irregular intervals), we maintain a buffer of recent snapshots
 * and render the kart at a position INTERPOLATION_DELAY seconds in the past.
 *
 * This means we always have two snapshots to smoothly interpolate between, resulting
 * in perfectly smooth movement regardless of network jitter.
 *
 * When no future snapshots are available (packet loss), we briefly extrapolate
 * using the last known velocity before freezing.
 */
export const RemoteKart = React.memo(function RemoteKart({
    id, playerName, dataRef, initialPosition, initialRotation, modelUrl, modelScale, color
}: RemoteKartProps) {
    const rigidBodyRef = useRef<RapierRigidBody>(null);

    // Snapshot ring buffer — sorted by receive time
    const snapshots = useRef<Snapshot[]>([]);
    // Track the last raw data we consumed from the shared ref (avoid re-processing same data)
    const lastConsumedTime = useRef(0);

    // Current rendered state (mutated in-place to avoid GC)
    const renderPos = useRef(new THREE.Vector3(...initialPosition));
    const renderQuat = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, initialRotation, 0)));

    // Reusable objects (zero allocation per frame)
    const _euler = useRef(new THREE.Euler());
    const _quatA = useRef(new THREE.Quaternion());
    const _vecA = useRef(new THREE.Vector3());

    // Object pool for snapshots — avoids creating new Vector3 per network message
    const snapshotPool = useRef<Snapshot[]>([]);
    const acquireSnapshot = (x: number, y: number, z: number, rot: number, speed: number, time: number): Snapshot => {
        const s = snapshotPool.current.pop();
        if (s) {
            s.pos.set(x, y, z);
            s.rot = rot;
            s.speed = speed;
            s.time = time;
            return s;
        }
        return { pos: new THREE.Vector3(x, y, z), rot, speed, time };
    };

    useFrame(() => {
        if (!rigidBodyRef.current) return;

        const now = performance.now() / 1000; // Convert to seconds

        // --- 1. Consume new data from shared ref ---
        const data = dataRef.current?.[id];
        if (data && data.t !== lastConsumedTime.current) {
            lastConsumedTime.current = data.t;

            const snapshot = acquireSnapshot(data.pos[0], data.pos[1], data.pos[2], data.rot, data.speed, now);

            // Insert into buffer (sorted by time — usually just push since they arrive in order)
            snapshots.current.push(snapshot);

            // Trim old snapshots — recycle evicted ones back to pool
            if (snapshots.current.length > MAX_SNAPSHOTS) {
                const evicted = snapshots.current.splice(0, snapshots.current.length - MAX_SNAPSHOTS);
                snapshotPool.current.push(...evicted);
            }
        }

        // --- 2. Snapshot Interpolation ---
        const buf = snapshots.current;
        if (buf.length === 0) return;

        // Render time is "now minus delay" — we're rendering in the past
        const renderTime = now - INTERPOLATION_DELAY;

        // Find the two snapshots that bracket renderTime
        let from: Snapshot | null = null;
        let to: Snapshot | null = null;

        for (let i = 0; i < buf.length - 1; i++) {
            if (buf[i].time <= renderTime && buf[i + 1].time >= renderTime) {
                from = buf[i];
                to = buf[i + 1];
                break;
            }
        }

        let targetPos: THREE.Vector3;
        let targetRot: number;

        if (from && to) {
            // Normal case: interpolate between two snapshots
            const duration = to.time - from.time;
            const t = duration > 0 ? (renderTime - from.time) / duration : 0;
            const alpha = Math.max(0, Math.min(1, t));

            targetPos = _vecA.current.copy(from.pos).lerp(to.pos, alpha);
            targetRot = lerpAngle(from.rot, to.rot, alpha);
        } else if (buf.length >= 2) {
            // Extrapolation: renderTime is ahead of our latest snapshot
            const latest = buf[buf.length - 1];
            const prev = buf[buf.length - 2];
            const timeSinceLatest = now - latest.time;

            if (timeSinceLatest < EXTRAPOLATION_LIMIT) {
                // Brief extrapolation using velocity derived from last two snapshots
                const dt = latest.time - prev.time;
                if (dt > 0) {
                    const vx = (latest.pos.x - prev.pos.x) / dt;
                    const vz = (latest.pos.z - prev.pos.z) / dt;
                    const extraTime = now - latest.time;
                    targetPos = _vecA.current.set(
                        latest.pos.x + vx * extraTime,
                        latest.pos.y, // Keep Y stable (ground snapping)
                        latest.pos.z + vz * extraTime,
                    );
                    targetRot = latest.rot;
                } else {
                    targetPos = latest.pos;
                    targetRot = latest.rot;
                }
            } else {
                // Stale data — just hold last position (player might be lagging)
                targetPos = latest.pos;
                targetRot = latest.rot;
            }
        } else {
            // Only one snapshot — use it directly
            targetPos = buf[0].pos;
            targetRot = buf[0].rot;
        }

        // --- 3. Check for teleport (respawn) ---
        const dist = renderPos.current.distanceTo(targetPos);
        if (dist > SNAP_DISTANCE) {
            // Snap instantly (player respawned or was teleported)
            renderPos.current.copy(targetPos);
            _euler.current.set(0, targetRot, 0);
            renderQuat.current.setFromEuler(_euler.current);
        } else {
            // Smooth final render (very light smoothing on top of interpolation
            // to handle any micro-jitter from the interpolation itself)
            const smoothFactor = 0.3; // Gentle — most of the work is done by snapshot interp
            renderPos.current.lerp(targetPos, smoothFactor);

            _euler.current.set(0, targetRot, 0);
            _quatA.current.setFromEuler(_euler.current);
            renderQuat.current.slerp(_quatA.current, smoothFactor);
        }

        // --- 4. Apply to physics body ---
        rigidBodyRef.current.setNextKinematicTranslation(renderPos.current);
        rigidBodyRef.current.setNextKinematicRotation(renderQuat.current);
    });

    return (
        <RigidBody
            ref={rigidBodyRef}
            type="kinematicPosition"
            name={id}
            position={initialPosition}
            rotation={[0, initialRotation, 0]}
            colliders="hull"
        >
            <CarModel url={modelUrl} scale={modelScale} color={color} />
            {playerName && <PlayerNameTag name={playerName} />}
        </RigidBody>
    );
});

/**
 * Lerp between two angles (radians) taking the shortest path.
 * Handles wrap-around at ±π correctly.
 */
function lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    // Normalize to [-π, π]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
}
