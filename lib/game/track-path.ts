import * as THREE from "three";
import type { MapConfig } from "./maps";

/**
 * Gera pontos (x, z) do caminho da pista.
 * Geometria idêntica ao Track.tsx — usada por KartPro, BotKart e MiniMap.
 */
export function generateTrackPoints(
  map: MapConfig,
  numPoints = 64
): [number, number][] {
  const { trackType, curveRadius, trackLength, pathPoints } = map;

  if (pathPoints && pathPoints.length > 2) {
    return pathPoints.map(([x, z]) => [x, z]);
  }

  const points: [number, number][] = [];

  switch (trackType) {
    case "oval":
      for (let i = 0; i < numPoints; i++) {
        const t = i / numPoints;
        const angle = Math.PI + t * Math.PI * 2;
        const x = Math.sin(angle) * curveRadius;
        const z = Math.cos(angle) * (trackLength / 2);
        points.push([x, z]);
      }
      break;

    case "figure8": {
      const loopRadius = curveRadius * 0.8;
      for (let i = 0; i < numPoints; i++) {
        const t = i / numPoints;
        let x: number, z: number;
        if (t < 0.5) {
          const angle = t * 2 * Math.PI * 2 - Math.PI / 2;
          x = -loopRadius + Math.cos(angle) * loopRadius;
          z = loopRadius + Math.sin(angle) * loopRadius;
        } else {
          const angle = -((t - 0.5) * 2 * Math.PI * 2) + Math.PI / 2;
          x = loopRadius + Math.cos(angle) * loopRadius;
          z = -loopRadius + Math.sin(angle) * loopRadius;
        }
        points.push([x, z]);
      }
      break;
    }

    case "circuit":
      for (let i = 0; i < numPoints; i++) {
        const t = i / numPoints;
        let x: number, z: number;
        if (t < 0.25) {
          x = curveRadius;
          z = -trackLength / 4 + (t * 4 * trackLength) / 2;
        } else if (t < 0.5) {
          x = curveRadius - (t - 0.25) * 4 * curveRadius * 2;
          z = trackLength / 4;
        } else if (t < 0.75) {
          x = -curveRadius;
          z = trackLength / 4 - ((t - 0.5) * 4 * trackLength) / 2;
        } else {
          x = -curveRadius + (t - 0.75) * 4 * curveRadius * 2;
          z = -trackLength / 4;
        }
        points.push([x, z]);
      }
      break;

    case "complex":
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const angle = t * Math.PI * 4;
        const radiusVar = curveRadius + Math.sin(angle * 2) * 20;
        const x = Math.sin(angle) * radiusVar;
        const z = t * trackLength - trackLength / 2;
        points.push([x, z]);
      }
      break;
  }

  return points;
}

// ── Spline Projection (industry-standard lap progress) ──────────────

const SPLINE_LOOKUP_SEGMENTS = 256;

/**
 * Pre-built lookup table for fast spline projection.
 * Instead of searching waypoints, projects the kart position onto the
 * track spline for continuous, monotonic progress values (0.0 - 1.0).
 */
export class TrackSpline {
  private curve: THREE.CatmullRomCurve3;
  private lookupPoints: THREE.Vector3[];
  private lookupT: number[];
  private segments: number;
  private startT: number; // offset so that start/finish line = 0.0

  constructor(map: MapConfig, segments = SPLINE_LOOKUP_SEGMENTS) {
    const rawPoints = generateTrackPoints(map, 128);
    const vec3Points = rawPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(vec3Points, true); // closed loop
    this.segments = segments;

    // Build lookup table: evenly-spaced points along curve
    this.lookupPoints = [];
    this.lookupT = [];
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      this.lookupT.push(t);
      this.lookupPoints.push(this.curve.getPointAt(t));
    }

    // Calibrate: find where the start/finish line projects onto the spline
    // so that progress=0.0 always corresponds to the start position
    const startPos = map.startPositions?.[0];
    if (startPos) {
      this.startT = this._projectRaw(startPos[0], startPos[2]);
    } else {
      this.startT = 0;
    }
  }

  /**
   * Raw projection without start offset.
   * Used internally for calibration and by the public project() method.
   */
  private _projectRaw(x: number, z: number, prevRawT?: number): number {
    // Convert prevT to segment index (use full-scan if no hint)
    const hint = prevRawT ?? 0;
    const prevIdx = Math.round(hint * this.segments) % this.segments;

    // Search radius — use full scan when no hint (calibration), local otherwise
    const searchRadius = prevRawT !== undefined ? 8 : this.segments;
    let bestIdx = prevIdx;
    let bestDist = Infinity;

    for (let i = -searchRadius; i <= searchRadius; i++) {
      const idx = ((prevIdx + i) % this.segments + this.segments) % this.segments;
      const pt = this.lookupPoints[idx];
      const dx = pt.x - x;
      const dz = pt.z - z;
      const dist = dx * dx + dz * dz; // squared distance (no sqrt needed)
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }

    // Refine between bestIdx and neighbors for sub-segment accuracy
    const idxA = ((bestIdx - 1) % this.segments + this.segments) % this.segments;
    const idxB = bestIdx;
    const idxC = (bestIdx + 1) % this.segments;

    const ptA = this.lookupPoints[idxA];
    const ptB = this.lookupPoints[idxB];
    const ptC = this.lookupPoints[idxC];

    const dA = (ptA.x - x) ** 2 + (ptA.z - z) ** 2;
    const dB = (ptB.x - x) ** 2 + (ptB.z - z) ** 2;
    const dC = (ptC.x - x) ** 2 + (ptC.z - z) ** 2;

    // Interpolate between the two closest points
    let t: number;
    if (dA < dC) {
      // Between A and B
      const total = Math.sqrt(dA) + Math.sqrt(dB);
      const frac = total > 0 ? Math.sqrt(dA) / total : 0.5;
      t = (this.lookupT[idxA] + frac * (this.lookupT[idxB] - this.lookupT[idxA] + (idxB < idxA ? 1 : 0)));
    } else {
      // Between B and C
      const total = Math.sqrt(dB) + Math.sqrt(dC);
      const frac = total > 0 ? Math.sqrt(dB) / total : 0.5;
      t = (this.lookupT[idxB] + frac * (this.lookupT[idxC] - this.lookupT[idxB] + (idxC < idxB ? 1 : 0)));
    }

    // Normalize to [0, 1)
    return ((t % 1) + 1) % 1;
  }

  /**
   * Project a world position onto the spline and return calibrated progress (0.0 - 1.0).
   * Progress = 0.0 at the start/finish line, increasing in race direction.
   * Uses the previous t as hint for fast local search (O(1) amortized).
   *
   * @param x - world X position
   * @param z - world Z position
   * @param prevT - previous calibrated progress (used as search hint)
   */
  project(x: number, z: number, prevT: number): number {
    // Convert calibrated prevT back to raw spline t for the search hint
    const prevRawT = ((prevT + this.startT) % 1 + 1) % 1;
    const rawT = this._projectRaw(x, z, prevRawT);
    // Subtract startT offset so that the start/finish line = 0.0
    return ((rawT - this.startT) % 1 + 1) % 1;
  }
}
