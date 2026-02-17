import * as THREE from "three";

export interface TrackSpline {
    id: string;
    controlPoints: THREE.Vector3[]; // Pontos de controle editáveis
    curve: THREE.CatmullRomCurve3;  // Curva interpolada
    length: number;                 // Comprimento total
    samples: number;                // Quantidade de samples para geração
}

export const DEFAULT_SPLINE_SAMPLES = 200;

/**
 * Creates a TrackSpline from a list of points.
 */
export function createTrackSpline(id: string, points: THREE.Vector3[], closed = true): TrackSpline {
    const curve = new THREE.CatmullRomCurve3(points, closed);
    // Recompute lengths immediately to ensure accuracy
    curve.updateArcLengths();

    return {
        id,
        controlPoints: points,
        curve,
        length: curve.getLength(),
        samples: DEFAULT_SPLINE_SAMPLES,
    };
}

/**
 * Gets a point on the spline at normalized t (0-1).
 */
export function getSplinePoint(spline: TrackSpline, t: number): THREE.Vector3 {
    return spline.curve.getPointAt(t);
}

/**
 * Gets the tangent vector on the spline at normalized t (0-1).
 */
export function getSplineTangent(spline: TrackSpline, t: number): THREE.Vector3 {
    return spline.curve.getTangentAt(t).normalize();
}

/**
 * Gets a point on the spline by distance from start.
 */
export function getSplinePointAtDistance(spline: TrackSpline, distance: number): THREE.Vector3 {
    const t = Math.max(0, Math.min(1, distance / spline.length));
    return spline.curve.getPointAt(t);
}

/**
 * Finds the closest point on the spline to a given world position.
 * Returns t (0-1), the point, and the distance from the input position.
 * Approximate solution using samples.
 */
export function getClosestPointOnSpline(spline: TrackSpline, position: THREE.Vector3, divisions = 100) {
    let bestT = 0;
    let minDst2 = Infinity;
    let bestPoint = new THREE.Vector3();

    // First pass: coarse search
    for (let i = 0; i <= divisions; i++) {
        const t = i / divisions;
        const p = spline.curve.getPointAt(t);
        const d2 = p.distanceToSquared(position);
        if (d2 < minDst2) {
            minDst2 = d2;
            bestT = t;
            bestPoint.copy(p);
        }
    }

    // Second pass: refine around bestT
    const range = 1 / divisions;
    const start = Math.max(0, bestT - range);
    const end = Math.min(1, bestT + range);
    const steps = 10;

    for (let i = 0; i <= steps; i++) {
        const t = start + (i / steps) * (end - start);
        const p = spline.curve.getPointAt(t);
        const d2 = p.distanceToSquared(position);
        if (d2 < minDst2) {
            minDst2 = d2;
            bestT = t;
            bestPoint.copy(p);
        }
    }

    return {
        t: bestT,
        point: bestPoint,
        distance: Math.sqrt(minDst2)
    };
}
