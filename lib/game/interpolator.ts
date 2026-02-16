import type { InterpolatedState } from "../../types/network";

export type Snapshot = {
    t: number; // serverTime
    p: [number, number, number];
    r: number;
    s: number;
    l: number;
    seq?: number;
};

class SnapshotBuffer {
    private snapshots: Snapshot[] = [];
    // Aumentado para 200ms para permitir mais suavidade na interpolação
    private static MAX_EXTRAPOLATION_TIME = 200; // ms
    // Aumentado o buffer de interpolação para 100ms
    private static INTERPOLATION_DELAY_MS = 100; // ms

    add(snapshot: Snapshot) {
        // Se o buffer estiver vazio, adiciona diretamente
        if (this.snapshots.length === 0) {
            this.snapshots.push(snapshot);
            return;
        }

        const newest = this.snapshots[this.snapshots.length - 1];

        // Rejeita apenas se for EXATAMENTE o mesmo timestamp ou mais antigo
        // Isso permite pacotes com delay mas ainda úteis
        if (snapshot.t <= newest.t) {
            // Se for muito próximo (menos de 5ms), descarta como duplicado
            if (newest.t - snapshot.t < 5) {
                return;
            }
            // Se for um pouco mais antigo mas ainda dentro da janela útil,
            // insere na posição correta em vez de descartar
            const insertIndex = this.snapshots.findIndex(s => s.t > snapshot.t);
            if (insertIndex !== -1) {
                this.snapshots.splice(insertIndex, 0, snapshot);
            } else {
                this.snapshots.push(snapshot);
            }
        } else {
            this.snapshots.push(snapshot);
        }

        // Keep only last 2 seconds (aumentado para ter mais buffer)
        const threshold = snapshot.t - 2000;
        if (this.snapshots[0].t < threshold) {
            const keepIndex = this.snapshots.findIndex(s => s.t >= threshold);
            if (keepIndex > 0) {
                this.snapshots = this.snapshots.slice(keepIndex);
            }
        }
    }

    getState(renderTime: number): InterpolatedState | null {
        if (this.snapshots.length === 0) return null;

        const newest = this.snapshots[this.snapshots.length - 1];
        const oldest = this.snapshots[0];

        // 1. Extrapolation (Dead Reckoning)
        if (renderTime >= newest.t) {
            const timeDiff = renderTime - newest.t;

            // Limit extrapolation to avoid karts driving through walls indefinitely
            if (timeDiff > SnapshotBuffer.MAX_EXTRAPOLATION_TIME) {
                // Clamp to max extrapolation
                return this.extrapolate(newest, SnapshotBuffer.MAX_EXTRAPOLATION_TIME);
            }

            return this.extrapolate(newest, timeDiff);
        }

        // 2. Interpolation
        // Find pair A, B where A.t <= renderTime <= B.t
        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const A = this.snapshots[i];
            // If we found a snapshot before renderTime, look for the next one
            if (A.t <= renderTime) {
                // If there is a next snapshot B
                if (i + 1 < this.snapshots.length) {
                    const B = this.snapshots[i + 1];
                    const range = B.t - A.t;
                    if (range <= 0.001) return this.mapToState(A);

                    const t = (renderTime - A.t) / range;
                    return this.interpolateSmooth(A, B, t);
                } else {
                    // If no future snapshot exists, always extrapolate 0ms
                    return this.extrapolate(A, 0);
                }
            }
        }

        // 3. Pre-buffer (renderTime < oldest)
        // If we are asking for a time before our buffer, we just return the oldest known state.
        return this.mapToState(oldest);
    }

    private mapToState(s: Snapshot): InterpolatedState {
        return {
            position: s.p,
            rotation: s.r,
            speed: s.s,
            lapProgress: s.l,
        };
    }

    private interpolate(A: Snapshot, B: Snapshot, t: number): InterpolatedState {
        return {
            position: [
                lerp(A.p[0], B.p[0], t),
                A.p[1], // força Y fixo
                lerp(A.p[2], B.p[2], t),
            ],
            rotation: lerpAngle(A.r, B.r, t),
            speed: lerp(A.s, B.s, t),
            lapProgress: lerp(A.l, B.l, t),
        };
    }

    /**
     * Interpolação suave com easing para reduzir micro-jitters
     */
    private interpolateSmooth(A: Snapshot, B: Snapshot, t: number): InterpolatedState {
        // Aplica easing suave (ease-in-out) para transições mais naturais
        const smoothT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        
        return {
            position: [
                lerp(A.p[0], B.p[0], smoothT),
                A.p[1], // mantém Y fixo para evitar flutuação
                lerp(A.p[2], B.p[2], smoothT),
            ],
            rotation: lerpAngleSmooth(A.r, B.r, smoothT),
            speed: lerp(A.s, B.s, smoothT),
            lapProgress: lerp(A.l, B.l, smoothT),
        };
    }

    /**
     * Projects state forward based on the last known velocity (implicit from previous snapshot or speed)
     * For now, we use a simple projection based on the car's orientation and speed.
     * This is smoother than calculating delta-pos between two snapshots which can be jittery.
     */
    private extrapolate(anchor: Snapshot, dt_ms: number): InterpolatedState {
        const dt_sec = dt_ms / 1000;

        // Simple linear projection using speed and rotation
        // position = old_pos + forward_vector * speed * dt

        const angle = anchor.r;
        const speed = anchor.s;

        const dx = Math.sin(angle) * speed * dt_sec;
        const dz = Math.cos(angle) * speed * dt_sec;

        return {
            position: [
                anchor.p[0] + dx,
                anchor.p[1], // Assume flat ground for short extrapolation
                anchor.p[2] + dz
            ],
            rotation: anchor.r,
            speed: anchor.s,
            lapProgress: anchor.l // Extrapolating lap progress is risky, keep static
        };
    }
}

export class SnapshotInterpolator {
    private buffers = new Map<string, SnapshotBuffer>();

    // Track last packet reception time (monotonic) to prune inactive entities
    private lastPacketTimes = new Map<string, number>();

    // We remove 'lastRenderTimes' to allow re-evaluation if needed, 
    // though typically render time increases monotonically.

    addSnapshot(id: string, snapshot: Snapshot) {
        let buf = this.buffers.get(id);
        if (!buf) {
            buf = new SnapshotBuffer();
            this.buffers.set(id, buf);
        }

        buf.add(snapshot);

        // Track activity using local monotonic time
        this.lastPacketTimes.set(id, performance.now());
    }

    getInterpolatedState(id: string, renderTime: number): InterpolatedState | null {
        const buf = this.buffers.get(id);
        if (!buf) return null;

        // Pass through to buffer logic (handles interpolation & extrapolation)
        return buf.getState(renderTime);
    }

    getActiveIds(now: number): string[] {
        const result: string[] = [];

        for (const [id, lastPacket] of this.lastPacketTimes) {
            // Keep alive for 3 seconds without packets
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

/**
 * Interpolação de ângulo com suavização adicional
 */
function lerpAngleSmooth(a: number, b: number, t: number) {
    let diff = b - a;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    
    // Aplica uma curva de suavização suave
    const smoothT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return a + diff * smoothT;
}

export const interpolator = new SnapshotInterpolator();
