import { Snapshot } from "./types"

export class SnapshotBuffer {
    buffer: Snapshot[] = []
    max = 120

    add(s: Snapshot) {
        this.buffer.push(s)
        if (this.buffer.length > this.max) this.buffer.shift()
    }

    get(time: number) {
        let older: Snapshot | undefined
        let newer: Snapshot | undefined

        for (const snap of this.buffer) {
            if (snap.time <= time) older = snap
            if (snap.time > time) {
                newer = snap
                break
            }
        }

        if (!older || !newer) return older ?? null

        const t = (time - older.time) / (newer.time - older.time)
        return { older, newer, t }
    }
}

export const snapshotBuffer = new SnapshotBuffer()
