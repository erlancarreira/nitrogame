import { interpolator } from "@/lib/game/interpolator";
import { useFrame } from "@react-three/fiber";
import { GameSceneProps } from "./GameScene";

export function NetworkInterpolationLoop({
    localPlayerId,
    handlePositionUpdate,
}: {
    localPlayerId?: string;
    handlePositionUpdate: GameSceneProps["handlePositionUpdate"];
}) {
    useFrame(() => {
        const now = performance.now();

        const ids = interpolator.getActiveIds(now);

        for (const id of ids) {
            if (id === localPlayerId) continue;

            const state = interpolator.getInterpolatedState(id, now);
            if (!state) continue;

            handlePositionUpdate(
                id,
                state.position,
                state.rotation,
                state.speed,
                state.lapProgress // ← CORRETO
            );
        }
    });

    return null;
}
