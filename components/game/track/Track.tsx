"use client";

import { type MapConfig } from "@/lib/game/maps";
import { SplineTrack } from "./SplineTrack";
import { ModelTrack, type ExtraCollider } from "./ModelTrack";
import { SplineTileTrack } from "./SplineTileTrack";

interface TrackProps {
    map: MapConfig;
    showWaypoints?: boolean;
    showArrows?: boolean;
    showCenterLine?: boolean;
}

type TrackSystemType = 'spline' | 'model' | 'spline-tiles';

function detectTrackSystem(map: MapConfig): TrackSystemType {
    // Prioridade: configuração explícita
    if (map.trackSystem?.type && map.trackSystem.type !== 'legacy') {
        return map.trackSystem.type as TrackSystemType;
    }

    // Inferir do modelo antigo
    if (map.modelUrl) {
        return 'model';
    }

    // Padrão: spline (legacy logic but using new component)
    return 'spline';
}

export function Track(props: TrackProps) {
    const system = detectTrackSystem(props.map);
    console.log("Track system", props.map.id, {
        decorationType: props.map.decorationType,
        trackSystem: props.map.trackSystem,
        system,
    });

    switch (system) {
        case 'model': {
            // ── cartoon-race-track-oval ──────────────────────────────────────────
            // Oval: rx=245m, rz=133m, trackWidth=25m, centro (0, -160.5)
            // Chão: cobre X:[-300,300] Z:[-320,0] (com margem)
            // Paredes: 4 paredes externas + bloqueador central da ilha interna
            //
            // Collider formato ExtraCollider: [halfX, halfY, halfZ, posX, posY, posZ]
            // halfY=5 → 10m de altura de parede (suficiente para karts)
            const groundCollider = props.map.id === 'cartoon-race-track-oval'
                ? [300, 160, 0, 0, -160] as [number, number, number, number, number]
                : undefined;

            const extraColliders: ExtraCollider[] | undefined =
                props.map.id === 'cartoon-race-track-oval'
                    ? [
                        // Parede Norte (Z > -15): tope da oval
                        [300, 5, 2, 0, 4, -13],
                        // Parede Sul (Z < -306): fundo da oval
                        [300, 5, 2, 0, 4, -308],
                        // Parede Leste (X > 257): lado direito
                        [2, 5, 165, 259, 4, -160],
                        // Parede Oeste (X < -257): lado esquerdo
                        [2, 5, 165, -259, 4, -160],
                        // Ilha central (impede atalho): elipse ≈ caixa conservadora
                        // rx_int=232.5 → caixa menor para não bloquear pista
                        [210, 5, 98, 0, 4, -160.5],
                    ]
                    : undefined;

            return <ModelTrack
                url={props.map.trackSystem?.modelUrl || props.map.modelUrl!}
                scale={props.map.trackSystem?.modelScale || props.map.modelScale}
                groundCollider={groundCollider}
                extraColliders={extraColliders}
            />;
        }

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
