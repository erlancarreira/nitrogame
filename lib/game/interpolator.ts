import type { InterpolatedState } from "../../types/network";

const IS_DEV = process.env.NODE_ENV === "development";

export type Snapshot = {
    t: number;  // serverTime (from sender's netClock)
    lt: number; // localTime (performance.now() at reception) — used for interpolation
    p: [number, number, number];
    r: number;
    s: number;
    l: number;
    seq?: number;
    vx?: number; // velocity X (real, from Rapier body)
    vz?: number; // velocity Z (real, from Rapier body)
};

class SnapshotBuffer {
    private snapshots: Snapshot[] = [];
    private static MAX_EXTRAPOLATION_MS = 300;

    // Visual smoothing state — prevents snapping when new packets arrive
    private smoothPos: [number, number, number] | null = null;
    private smoothRot: number | null = null;

    // Dedup: track recent server timestamps to reject duplicate POS messages.
    // The same POS arrives via both WebRTC (fast) and Socket.IO relay (slow)
    // with identical `t` but different `lt` — without dedup, the buffer gets
    // interleaved duplicates that cause zigzag interpolation (teleportation).
    private recentTs = new Set<number>();

    add(snapshot: Snapshot) {
        // Dedup by server timestamp — both transport paths carry identical t
        if (this.recentTs.has(snapshot.t)) return;
        this.recentTs.add(snapshot.t);
        if (this.recentTs.size > 30) {
            // Prune oldest (Set iterates in insertion order)
            this.recentTs.delete(this.recentTs.values().next().value!);
        }

        if (this.snapshots.length === 0) {
            this.snapshots.push(snapshot);
            return;
        }

        const newest = this.snapshots[this.snapshots.length - 1];

        if (snapshot.lt <= newest.lt) {
            // Out-of-order but still usable: insert in sorted position by lt
            const insertIndex = this.snapshots.findIndex(s => s.lt > snapshot.lt);
            if (insertIndex !== -1) {
                this.snapshots.splice(insertIndex, 0, snapshot);
            } else {
                this.snapshots.push(snapshot);
            }
        } else {
            this.snapshots.push(snapshot);
        }

        // Prune: keep only last 2 seconds (by local time)
        const threshold = snapshot.lt - 2000;
        if (this.snapshots[0].lt < threshold) {
            const keepIndex = this.snapshots.findIndex(s => s.lt >= threshold);
            if (keepIndex > 0) {
                this.snapshots = this.snapshots.slice(keepIndex);
            }
        }
    }

    // Debug: throttle logs to avoid console spam
    private _lastDebugLog = 0;

    /**
     * Get interpolated state at a given LOCAL renderTime (performance.now() based).
     * All interpolation is done in the `lt` (local time) domain, making it
     * completely independent of clock synchronization between clients.
     */
    getState(renderTime: number): InterpolatedState | null {
        if (this.snapshots.length === 0) return null;

        const newest = this.snapshots[this.snapshots.length - 1];
        const oldest = this.snapshots[0];

        let rawState: InterpolatedState;

        // 1. Extrapolation (renderTime is ahead of newest)
        if (renderTime >= newest.lt) {
            const timeDiff = renderTime - newest.lt;

            // Debug: log when we're stuck extrapolating
            if (IS_DEV && timeDiff > 100) {
                const now = performance.now();
                if (now - this._lastDebugLog > 1000) {
                    this._lastDebugLog = now;
                    console.warn(
                        `[interp] EXTRAPOLATING ${timeDiff.toFixed(0)}ms ahead | ` +
                        `buf=${this.snapshots.length} | newest.lt=${newest.lt.toFixed(0)} | ` +
                        `renderTime=${renderTime.toFixed(0)} | gap=${(now - newest.lt).toFixed(0)}ms since last pkt`
                    );
                }
            }

            const clampedDiff = Math.min(timeDiff, SnapshotBuffer.MAX_EXTRAPOLATION_MS);
            rawState = this.extrapolate(newest, clampedDiff);
        }
        // 2. Interpolation — find pair A, B where A.lt <= renderTime <= B.lt
        else {
            let found = false;
            for (let i = this.snapshots.length - 1; i >= 0; i--) {
                const A = this.snapshots[i];
                if (A.lt <= renderTime) {
                    if (i + 1 < this.snapshots.length) {
                        const B = this.snapshots[i + 1];
                        const range = B.lt - A.lt;
                        if (range <= 0.001) {
                            rawState = this.mapToState(A);
                        } else {
                            const alpha = Math.min(Math.max((renderTime - A.lt) / range, 0), 1);
                            rawState = this.interpolateLerp(A, B, alpha);
                        }
                    } else {
                        rawState = this.extrapolate(A, 0);
                    }
                    found = true;
                    break;
                }
            }
            if (!found) {
                // 3. Pre-buffer (renderTime < oldest)
                rawState = this.mapToState(oldest);
            }
        }

        // Apply visual smoothing — lerp towards raw to prevent snapping
        if (this.smoothPos === null) {
            this.smoothPos = [...rawState!.position];
            this.smoothRot = rawState!.rotation;
        } else {
            // Smooth factor: 0.35 gives responsive-but-smooth blending at 60fps
            // Higher = more responsive, lower = smoother but more latent
            const SMOOTH_FACTOR = 0.35;
            this.smoothPos[0] += (rawState!.position[0] - this.smoothPos[0]) * SMOOTH_FACTOR;
            this.smoothPos[1] += (rawState!.position[1] - this.smoothPos[1]) * SMOOTH_FACTOR;
            this.smoothPos[2] += (rawState!.position[2] - this.smoothPos[2]) * SMOOTH_FACTOR;
            this.smoothRot = lerpAngle(this.smoothRot!, rawState!.rotation, SMOOTH_FACTOR);

            // Anti-teleport: if distance is huge, snap immediately (e.g. respawn)
            const dx = rawState!.position[0] - this.smoothPos[0];
            const dz = rawState!.position[2] - this.smoothPos[2];
            if (dx * dx + dz * dz > 25) { // >5m = teleport, snap
                this.smoothPos = [...rawState!.position];
                this.smoothRot = rawState!.rotation;
            }
        }

        return {
            position: [this.smoothPos[0], this.smoothPos[1], this.smoothPos[2]],
            rotation: this.smoothRot!,
            speed: rawState!.speed,
            lapProgress: rawState!.lapProgress,
        };
    }

    private mapToState(s: Snapshot): InterpolatedState {
        return {
            position: [s.p[0], s.p[1], s.p[2]],
            rotation: s.r,
            speed: s.s,
            lapProgress: s.l,
        };
    }

    /**
     * Linear interpolation between two snapshots.
     * Uses plain lerp (no easing) — easing on interpolation causes the "go back and snap"
     * artefact because ease-in-out decelerates at start and end, which at high packet rates
     * makes the visual position oscillate around the true position.
     */
    private interpolateLerp(A: Snapshot, B: Snapshot, alpha: number): InterpolatedState {
        return {
            position: [
                lerp(A.p[0], B.p[0], alpha),
                lerp(A.p[1], B.p[1], alpha),
                lerp(A.p[2], B.p[2], alpha),
            ],
            rotation: lerpAngle(A.r, B.r, alpha),
            speed: lerp(A.s, B.s, alpha),
            lapProgress: lerp(A.l, B.l, alpha),
        };
    }

    /**
     * Extrapolation using real velocity when available (handles curves/drift correctly),
     * falling back to speed * forward direction when velocity is unavailable.
     */
    private extrapolate(anchor: Snapshot, dt_ms: number): InterpolatedState {
        const dt_sec = dt_ms / 1000;

        let dx: number, dz: number;

        if (anchor.vx !== undefined && anchor.vz !== undefined) {
            // Use real velocity — accurate during drift/curves
            dx = anchor.vx * dt_sec;
            dz = anchor.vz * dt_sec;
        } else {
            // Fallback: speed * forward direction
            dx = Math.sin(anchor.r) * anchor.s * dt_sec;
            dz = Math.cos(anchor.r) * anchor.s * dt_sec;
        }

        return {
            position: [
                anchor.p[0] + dx,
                anchor.p[1],
                anchor.p[2] + dz,
            ],
            rotation: anchor.r,
            speed: anchor.s,
            lapProgress: anchor.l,
        };
    }
}

export class SnapshotInterpolator {
    private buffers = new Map<string, SnapshotBuffer>();
    private lastPacketTimes = new Map<string, number>();

    addSnapshot(id: string, snapshot: Snapshot) {
        let buf = this.buffers.get(id);
        if (!buf) {
            buf = new SnapshotBuffer();
            this.buffers.set(id, buf);
        }

        buf.add(snapshot);
        this.lastPacketTimes.set(id, performance.now());
    }

    getInterpolatedState(id: string, renderTime: number): InterpolatedState | null {
        const buf = this.buffers.get(id);
        if (!buf) return null;
        return buf.getState(renderTime);
    }

    getActiveIds(now: number): string[] {
        const result: string[] = [];

        for (const [id, lastPacket] of this.lastPacketTimes) {
            if (now - lastPacket <= 3000) {
                result.push(id);
            } else {
                this.buffers.delete(id);
                this.lastPacketTimes.delete(id);
            }
        }

        return result;
    }
}

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
    let diff = b - a;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return a + diff * t;
}

export const interpolator = new SnapshotInterpolator();
