import { interpolator } from "@/lib/game/interpolator";
import { useFrame } from "@react-three/fiber";
import React from "react";
import { GameSceneProps } from "./GameScene";
import { netClock } from "@/lib/netcode/netclock";

// Use 150ms to smooth out jitter. 
// Server sends at 20Hz (50ms interval), so 150ms = 3 snapshots buffered.
export const INTERPOLATION_DELAY_MS = 150;


export function NetworkInterpolationLoop({
    localPlayerId,
    ignoredIds = [],
    handlePositionUpdate,
}: {
    localPlayerId?: string;
    ignoredIds?: string[];
    handlePositionUpdate: GameSceneProps["handlePositionUpdate"];
}) {
    const lastUpdateRef = React.useRef(0);

    useFrame(() => {
        const now = performance.now();

        // Throttle logic updates to 10Hz (100ms)
        // Visual smoothness is handled by RemoteKart directly hitting interpolator at 60fps+
        if (now - lastUpdateRef.current < 100) return;
        lastUpdateRef.current = now;

        const serverTime = netClock.now;

        // Safety: If netClock is not ready or valid, don't interpolate yet
        if (serverTime <= 0) return;

        const renderTime = serverTime - INTERPOLATION_DELAY_MS;

        // Pruning is based on local monotonic activity time
        const ids = interpolator.getActiveIds(now);

        for (const id of ids) {
            if (id === localPlayerId || ignoredIds.includes(id)) continue;

            const state = interpolator.getInterpolatedState(id, renderTime);
            if (!state) continue;

            handlePositionUpdate(
                id,
                state.position,
                state.rotation,
                state.speed,
                state.lapProgress
            );
        }
    });

    return null;
}
