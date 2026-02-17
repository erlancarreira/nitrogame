"use client";

import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { soundManager } from "@/lib/game/sound-manager";
import type { KartRef } from "./KartPro";
import type { RacerState } from "@/hooks/use-race-state";

/**
 * SpatialEngineSound — Professional multi-kart engine audio.
 *
 * Renders inside the R3F Canvas. Each frame, it calculates the distance
 * and stereo pan from the player's kart to each rival kart, then updates
 * the SoundManager's spatial engine system accordingly.
 *
 * Technique used by Forza Motorsport, Gran Turismo, Mario Kart 8:
 * - Each rival has its own engine loop with independent pitch/volume
 * - Volume falls off with distance² (inverse square law)
 * - Stereo pan follows the rival's angle relative to the player's facing direction
 * - Slight pitch variation per-kart (each engine sounds unique)
 */

interface RivalKartInfo {
    id: string;
    /** Get position as [x, y, z] */
    getPosition: () => [number, number, number] | null;
    /** Get speed (for pitch calculation) */
    getSpeed: () => number;
    /** Max speed for this kart type */
    maxSpeed: number;
}

interface SpatialEngineSoundProps {
    /** Player's transform ref (position + rotation) */
    playerTransformRef: React.MutableRefObject<{
        position: [number, number, number];
        rotation: number;
    }>;
    /** Bot kart refs (keyed by id) */
    botRefs: React.MutableRefObject<Record<string, KartRef>>;
    /** Racer states ref (for real-time speed data) */
    racerStatesRef?: React.MutableRefObject<Map<string, RacerState>>;
    /** Bot player definitions (for maxSpeed/difficulty) */
    botPlayers: Array<{ id: string; isBot: boolean }>;
    /** Bot difficulty (affects maxSpeed for pitch calc) */
    botDifficulty: "easy" | "medium" | "hard";
    /** Whether the sound system is active */
    enabled: boolean;
}

const DIFFICULTY_MAX_SPEED: Record<string, number> = {
    easy: 25,
    medium: 35,
    hard: 42,
};

export function SpatialEngineSound({
    playerTransformRef,
    botRefs,
    racerStatesRef,
    botPlayers,
    botDifficulty,
    enabled,
}: SpatialEngineSoundProps) {
    // Track registered kart IDs to manage lifecycle
    const registeredIds = useRef<Set<string>>(new Set());

    // Reusable vectors (avoid GC pressure in useFrame)
    const _playerPos = useRef(new THREE.Vector3());
    const _playerForward = useRef(new THREE.Vector3());
    const _rivalPos = useRef(new THREE.Vector3());
    const _toRival = useRef(new THREE.Vector3());

    // Cleanup on unmount or disable
    useEffect(() => {
        return () => {
            for (const id of registeredIds.current) {
                soundManager.stopSpatialEngine(id, 300);
            }
            registeredIds.current.clear();
        };
    }, []);

    useEffect(() => {
        if (!enabled) {
            for (const id of registeredIds.current) {
                soundManager.stopSpatialEngine(id, 400);
            }
            registeredIds.current.clear();
        }
    }, [enabled]);

    useFrame(() => {
        if (!enabled) return;

        // Player position and forward vector
        const pPos = playerTransformRef.current.position;
        const pRot = playerTransformRef.current.rotation;
        _playerPos.current.set(pPos[0], pPos[1], pPos[2]);
        _playerForward.current.set(Math.sin(pRot), 0, Math.cos(pRot));

        // Collect all rival karts from centralized state
        const rivals: RivalKartInfo[] = [];

        if (racerStatesRef?.current) {
            for (const racer of racerStatesRef.current.values()) {
                if (racer.isPlayer) continue; // Skip local player (listener)

                // Determine if bot to set max speed
                const isBot = botPlayers.find(b => b.id === racer.id)?.isBot;
                const maxSpeed = isBot ? DIFFICULTY_MAX_SPEED[botDifficulty] : 45;

                rivals.push({
                    id: racer.id,
                    getPosition: () => racer.kartPosition,
                    getSpeed: () => Math.abs(racer.speed),
                    maxSpeed,
                });
            }
        }

        // Track which IDs are still active this frame
        const activeIds = new Set<string>();

        for (const rival of rivals) {
            const pos = rival.getPosition();
            if (!pos) continue;

            activeIds.add(rival.id);

            // Register if not already
            if (!registeredIds.current.has(rival.id)) {
                soundManager.load(); // no-op if already loaded
                soundManager.startSpatialEngine(rival.id);
                registeredIds.current.add(rival.id);
            }

            // Calculate distance
            _rivalPos.current.set(pos[0], pos[1], pos[2]);
            const distance = _playerPos.current.distanceTo(_rivalPos.current);

            // Calculate stereo pan based on angle relative to player's facing direction
            // Cross product Y-component gives signed angle (positive = right, negative = left)
            _toRival.current.subVectors(_rivalPos.current, _playerPos.current);
            _toRival.current.y = 0;
            const dist2D = _toRival.current.length();

            let pan = 0;
            if (dist2D > 0.1) {
                _toRival.current.normalize();
                // Cross product (forward × toRival).y gives the signed direction
                const cross = _playerForward.current.x * _toRival.current.z -
                    _playerForward.current.z * _toRival.current.x;
                // Dot product gives how much in front/behind
                const dot = _playerForward.current.dot(_toRival.current);
                // Pan: strong when to the side, subtle when in front/behind
                pan = -cross; // Negate because cross product sign convention
                // Enhance pan for karts that are beside us vs in front
                if (Math.abs(dot) < 0.3) {
                    pan *= 1.2; // Kart is nearly perpendicular — stronger pan
                }
            }

            soundManager.updateSpatialEngine(
                rival.id,
                distance,
                pan,
                rival.getSpeed(),
                rival.maxSpeed
            );
        }

        // Remove engines for karts that are no longer in the scene
        for (const id of registeredIds.current) {
            if (!activeIds.has(id)) {
                soundManager.stopSpatialEngine(id, 300);
                registeredIds.current.delete(id);
            }
        }
    });

    return null;
}
