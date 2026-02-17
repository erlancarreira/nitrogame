import * as THREE from "three";
import { TrackSpline, getSplinePoint, getSplineTangent } from "./spline";

export type TileType =
    | 'straight'
    | 'curve_left'
    | 'curve_right'
    | 's_curve_left'
    | 's_curve_right'
    | 'hairpin_left'
    | 'hairpin_right'
    | 'straight_up'
    | 'straight_down'
    | 'jump'
    | 'banked_left'
    | 'banked_right'
    | 'intersection'
    | 'start_line'
    | 'finish_line';

export type SurfaceType = 'asphalt' | 'dirt' | 'grass' | 'ice' | 'sand';
export type BarrierType = 'metal' | 'concrete' | 'tire_wall' | 'none';
export type DecorSet = 'forest' | 'desert' | 'snow' | 'city' | 'racing_kit' | 'none';

export interface TileConfig {
    type: TileType;
    width: number;           // Largura da pista neste tile
    length: number;          // Comprimento do segmento
    elevation: number;       // Variação de altura relative ao start do tile
    bankAngle: number;       // Ângulo de inclinação (-45 a 45) em graus
    surface: SurfaceType;
    barriers: BarrierType;
    decorations: DecorSet;
}

export interface PlacedTile {
    id: string;
    config: TileConfig;
    transform: THREE.Matrix4; // Posição/rotação global do início do tile
    splineRange: { start: number, end: number }; // Range na spline global (t: 0-1)
    connections: {
        entry: THREE.Vector3;
        exit: THREE.Vector3;
        entryTangent: THREE.Vector3; // Direção de entrada
        exitTangent: THREE.Vector3;  // Direção de saída
    };
}

/**
 * Generates the geometry (vertices, UVs) for a single tile.
 * This function creates a flat strip of triangles following the tile's internal spline path.
 */
export function generateTileGeometry(
    tile: PlacedTile,
    spline: TrackSpline,
    samples = 20
): { positions: Float32Array, uvs: Float32Array, normals: Float32Array, indices: number[] } {

    const width = tile.config.width;
    const halfWidth = width / 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const tStart = tile.splineRange.start;
    const tEnd = tile.splineRange.end;

    // Create a localized spline segment for this tile
    const segmentLength = tEnd - tStart;

    for (let i = 0; i <= samples; i++) {
        const tLocal = i / samples;
        const tGlobal = tStart + tLocal * segmentLength;

        // Get point and tangent from the global spline
        // Note: This assumes the global spline exactly passes through the tile.
        // In a real procedural system, the global spline is BUILT from these tiles.
        // Here we sample the global spline.
        const p = getSplinePoint(spline, tGlobal);
        const tangent = getSplineTangent(spline, tGlobal);

        // Calculate right vector (perpendicular to tangent and up)
        const up = new THREE.Vector3(0, 1, 0);

        // Apply banking (rotation around tangent)
        // Simple banking: rotate Up vector
        const bankRad = (tile.config.bankAngle * Math.PI / 180) * tLocal; // Simple linear banking for now
        const variableUp = up.clone().applyAxisAngle(tangent, bankRad);

        const right = new THREE.Vector3().crossVectors(tangent, variableUp).normalize();

        // Left and Right vertices
        const leftPos = p.clone().addScaledVector(right, -halfWidth);
        const rightPos = p.clone().addScaledVector(right, halfWidth);

        // Push vertices
        positions.push(leftPos.x, leftPos.y, leftPos.z);
        positions.push(rightPos.x, rightPos.y, rightPos.z);

        // Push Normals (approximate as Up for track surface)
        normals.push(variableUp.x, variableUp.y, variableUp.z);
        normals.push(variableUp.x, variableUp.y, variableUp.z);

        // Push UVs
        // U = across width (0-1), V = along length (0-1)
        uvs.push(0, tLocal);
        uvs.push(1, tLocal);

        // Generate indices for quad (2 triangles)
        if (i < samples) {
            const base = i * 2;
            // Triangle 1
            indices.push(base, base + 2, base + 1);
            // Triangle 2
            indices.push(base + 1, base + 2, base + 3);
        }
    }

    return {
        positions: new Float32Array(positions),
        uvs: new Float32Array(uvs),
        normals: new Float32Array(normals),
        indices
    };
}
