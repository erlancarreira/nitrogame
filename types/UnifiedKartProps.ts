import { MapConfig } from "@/lib/game/maps";
import { KartPhysicsConfig, KartPresetId } from "@/lib/game/physics-presets";
import { Controls } from "@/lib/game/types";
import * as THREE from "three";

export type KartMode = "local" | "bot" | "remote";

export interface UnifiedKartProps {
    id: string;
    mode: KartMode;
    playerName?: string;
    playerColor?: string;
    startPosition: [number, number, number];
    initialRotation?: number;
    modelUrl?: string;
    modelScale?: number;
    controls?: Controls;
    touchControlsRef?: React.RefObject<Controls>;
    raceStarted?: boolean;
    map?: MapConfig;
    botDifficulty?: "easy" | "medium" | "hard";
    remoteDataRef?: React.MutableRefObject<
        Record<string, {
            pos: [number, number, number];
            rot: number;
            speed: number;
            lapProgress: number;
            t: number;
        }>
    >;
    physicsPreset?: KartPresetId | KartPhysicsConfig;
    onSpeedChange?: (speed: number) => void;
    onPositionUpdate?: (
        id: string,
        position: [number, number, number],
        rotation: number,
        speed: number,
        lapProgress: number
    ) => void;
    onKartTransformChange?: (position: [number, number, number], rotation: number) => void;
    onEffectsUpdate?: (effects: {
        isDrifting: boolean;
        isBoosting: boolean;
        boostStrength: number;
        driftTier: number;
    }) => void;
}

export interface UnifiedKartRef {
    getPosition: () => [number, number, number];
    getRotation: () => number;
    getGroup: () => THREE.Group | null;
    applyBoost: (strength?: number, duration?: number) => void;
    applyStarPower: (duration?: number) => void;
    applyOilSlip: (duration?: number) => void;
    spinOut: () => void;
}