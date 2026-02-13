import * as THREE from "three";
import type { MapConfig } from "@/lib/game/maps";
import { generateTrackPoints } from "./track-path";

export const TRACK_PATH_SAMPLES = 64;

/**
 * Generates a THREE.Vector3[] track path from the map config.
 * Delegates to generateTrackPoints() (single source of truth for track geometry)
 * and maps [x, z] -> Vector3(x, 0.01, z).
 */
export function generateTrackPath(map: MapConfig): THREE.Vector3[] {
    return generateTrackPoints(map, TRACK_PATH_SAMPLES).map(
        ([x, z]) => new THREE.Vector3(x, 0.01, z)
    );
}

// Helper para limpar pontos duplicados/muito próximos
export function cleanPoints(points: THREE.Vector3[], threshold = 0.01): THREE.Vector3[] {
    const cleaned: THREE.Vector3[] = [];
    for (const p of points) {
        if (cleaned.length === 0 || p.distanceTo(cleaned[cleaned.length - 1]) >= threshold) {
            cleaned.push(p);
        }
    }
    return cleaned;
}

// ── Item Box Generation ──────────────────────────────────────────────
// Projects item boxes onto the actual track spline (CatmullRomCurve3),
// using perpendicular offsets to guarantee placement on pavement.
// Spacing between groups adapts to track length; lateral spread adapts
// to track width with a safe cap to avoid edge overflow.
export function generateItemBoxPositions(map: MapConfig): THREE.Vector3[] {
    let path = generateTrackPath(map);
    path = cleanPoints(path);

    // Remove duplicate closure point so CatmullRom loops correctly
    if (path.length > 2 && path[path.length - 1].distanceTo(path[0]) < 0.1) {
        path.pop();
    }

    const curve = new THREE.CatmullRomCurve3(path, true);
    const boxes: THREE.Vector3[] = [];

    const totalLength = curve.getLength();
    // ~1 group per 100m of track — minimum 4 groups, maximum 12
    const boxCount = Math.max(4, Math.min(12, Math.floor(totalLength / 100)));

    // Reusable vectors (avoid GC in loop)
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3();

    for (let i = 0; i < boxCount; i++) {
        const t = (i + 0.5) / boxCount;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).normalize();

        right.crossVectors(tangent, up).normalize();

        // Lateral spread: 25% of half-width, clamped to [1.5, 6.0] meters.
        const halfWidth = map.trackWidth / 2;
        const spread = Math.max(1.5, Math.min(6.0, halfWidth * 0.25));

        boxes.push(point.clone());                                             // Center
        boxes.push(point.clone().add(right.clone().multiplyScalar(spread)));   // Right
        boxes.push(point.clone().add(right.clone().multiplyScalar(-spread)));  // Left
    }

    // Set all boxes at floating height above track surface
    boxes.forEach(b => b.y = 1.5);
    return boxes;
}
