"use client";

import React, { useMemo } from "react";
import { RigidBody, TrimeshCollider } from "@react-three/rapier";
import { PlacedTile, generateTileGeometry } from "@/lib/game/track";
import { TrackSpline } from "@/lib/game/track/spline";

interface TileColliderProps {
    tile: PlacedTile;
    spline: TrackSpline;
}

export function TileCollider({ tile, spline }: TileColliderProps) {
    const { positions, indices } = useMemo(() => {
        // Generate raw vertex data for physics
        // We can use lower resolution for physics if needed
        const data = generateTileGeometry(tile, spline, 10);

        return {
            positions: data.positions,
            indices: new Uint32Array(data.indices)
        };
    }, [tile, spline]);

    return (
        <RigidBody type="fixed" colliders={false}>
            <TrimeshCollider
                args={[positions, indices]}
            />
        </RigidBody>
    );
}
