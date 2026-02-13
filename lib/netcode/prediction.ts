import { InputCmd, NetTransform } from "./types"

export class Prediction {
    pending: InputCmd[] = []
    lastServerState?: NetTransform

    pushInput(cmd: InputCmd) {
        this.pending.push(cmd)
    }

    applyLocal(state: NetTransform, simulate: (s: NetTransform, i: InputCmd) => void) {
        for (const input of this.pending) {
            simulate(state, input)
        }
    }

    reconcile(serverState: NetTransform, simulate: (s: NetTransform, i: InputCmd) => void) {
        this.lastServerState = serverState

        this.pending = this.pending.filter(i => i.seq > serverState.t)

        const corrected = structuredClone(serverState)

        for (const input of this.pending) {
            simulate(corrected, input)
        }

        return corrected
    }
}

export const prediction = new Prediction()
