"use client";

import React from "react";
import { type MapConfig } from "@/lib/game/maps";
import { SplineTrack } from "./SplineTrack";
import { TileKitTrack } from "./TileKitTrack";
import { ModelTrack } from "./ModelTrack";
import { SplineTileTrack } from "./SplineTileTrack";

interface TrackProps {
    map: MapConfig;
    showWaypoints?: boolean;
    showArrows?: boolean;
    showCenterLine?: boolean;
}

type TrackSystemType = 'spline' | 'tile-kit' | 'model' | 'spline-tiles';

function detectTrackSystem(map: MapConfig): TrackSystemType {
    // Prioridade: configuração explícita
    if (map.trackSystem?.type && map.trackSystem.type !== 'legacy') {
        return map.trackSystem.type as TrackSystemType;
    }

    // Inferir do modelo antigo
    if (map.modelUrl) {
        return 'model';
    }

    if ((map.decorationType as string) === 'racing-kit') {
        return 'tile-kit';
    }

    // Padrão: spline (legacy logic but using new component)
    return 'spline';
}

export function Track(props: TrackProps) {
    const system = detectTrackSystem(props.map);

    switch (system) {
        case 'model':
            return <ModelTrack
                url={props.map.trackSystem?.modelUrl || props.map.modelUrl!}
                scale={props.map.trackSystem?.modelScale || props.map.modelScale}
            />;

        case 'tile-kit':
            return <TileKitTrack
                map={props.map}
                showArrows={props.showArrows}
                showCenterLine={props.showCenterLine}
            />;

        case 'spline-tiles':
            return <SplineTileTrack
                map={props.map}
                showWaypoints={props.showWaypoints}
            />;

        case 'spline':
        default:
            return <SplineTrack {...props} />;
    }
}
