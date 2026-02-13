export type Snapshot = {
    t: number
    p: [number, number, number]
    r: number
    s: number
    l: number
}

type PlayerBuffer = {
    snaps: Snapshot[]
    lastT: number
}

const INTERP_DELAY = 100 // ms buffer de render (ideal 80–120)

export class SnapshotInterpolator {
    private buffers = new Map<string, PlayerBuffer>()

    addSnapshot(id: string, snap: Snapshot) {
        let buf = this.buffers.get(id)

        if (!buf) {
            buf = { snaps: [], lastT: 0 }
            this.buffers.set(id, buf)
        }

        // descarta pacote velho
        if (snap.t <= buf.lastT) return

        buf.lastT = snap.t
        buf.snaps.push(snap)

        // mantém buffer curto
        if (buf.snaps.length > 20) buf.snaps.shift()
    }

    removePlayer(id: string) {
        this.buffers.delete(id)
    }

    getInterpolatedState(id: string, now: number) {
        const buf = this.buffers.get(id)
        if (!buf || buf.snaps.length < 2) return null

        // limpeza snapshots antigos
        while (buf.snaps.length >= 2 && now - buf.snaps[1].t > 2000) {
            buf.snaps.shift()
        }

        const renderTime = now - INTERP_DELAY

        let a = buf.snaps[0]
        let b = buf.snaps[buf.snaps.length - 1]

        for (let i = 0; i < buf.snaps.length - 1; i++) {
            if (
                buf.snaps[i].t <= renderTime &&
                buf.snaps[i + 1].t >= renderTime
            ) {
                a = buf.snaps[i]
                b = buf.snaps[i + 1]
                break
            }
        }

        const span = b.t - a.t || 1

        let alpha = (renderTime - a.t) / span
        alpha = Math.max(0, Math.min(1, alpha))

        return {
            position: [
                lerp(a.p[0], b.p[0], alpha),
                lerp(a.p[1], b.p[1], alpha),
                lerp(a.p[2], b.p[2], alpha),
            ] as [number, number, number],
            rotation: lerpAngle(a.r, b.r, alpha),
            speed: lerp(a.s, b.s, alpha),
            lapProgress: lerp(a.l, b.l, alpha),
        }
    }

    getActiveIds(now: number): string[] {
        const result: string[] = []

        for (const [id, buf] of this.buffers) {
            // remove player se não envia update há 3s
            if (now - buf.lastT > 3000) {
                this.buffers.delete(id)
                continue
            }
            result.push(id)
        }

        return result
    }

}


function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t
}

function lerpAngle(a: number, b: number, t: number) {
    let diff = b - a
    while (diff < -Math.PI) diff += Math.PI * 2
    while (diff > Math.PI) diff -= Math.PI * 2
    return a + diff * t
}

export const interpolator = new SnapshotInterpolator()
