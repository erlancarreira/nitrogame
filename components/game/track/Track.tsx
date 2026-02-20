"use client";

import { type MapConfig } from "@/lib/game/maps";
import { SplineTrack } from "./SplineTrack";
import { ModelTrack } from "./ModelTrack";

interface TrackProps {
    map: MapConfig;
    showWaypoints?: boolean;
    showArrows?: boolean;
    showCenterLine?: boolean;
}

type TrackSystemType = 'spline' | 'model';

function detectTrackSystem(map: MapConfig): TrackSystemType {
    if (map.trackSystem?.type === 'model' || map.modelUrl) {
        return 'model';
    }
    return 'spline';
}

export function Track(props: TrackProps) {
    const system = detectTrackSystem(props.map);

    if (system === 'model') {
        // Collider de chão via mesh "1TARMAC_oval" (trimesh da geometria real).
        // Colliders de paredes/barreiras gerados automaticamente em ModelTrack
        // para meshes com prefixo "wall", "barriers" ou "prop_cone" no GLB.
        const trackMeshName = props.map.id === 'cartoon-race-track-oval'
            ? '1TARMAC_oval'
            : undefined;

        return <ModelTrack
            url={props.map.trackSystem?.modelUrl || props.map.modelUrl!}
            scale={props.map.trackSystem?.modelScale || props.map.modelScale}
            trackMeshName={trackMeshName}
        />;
    }

    return <SplineTrack {...props} />;
}
