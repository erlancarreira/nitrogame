import { snapshotBuffer } from "./snapshot-buffer"
import { interpTransform } from "./interpolator"
import { netClock } from "./netclock"
import { Snapshot, NetTransform } from "./types"

type NetMsg =
  | { type:"snapshot"; data: Snapshot }
  | { type:"time"; serverTime:number }

class NetworkManager {
    socket?: WebSocket
    tickRate = 15
    interpolationDelay = 100
    players = new Map<string, NetTransform>()

    connect(url: string) {
        this.socket = new WebSocket(url)

        this.socket.onmessage = e => {
            const msg: NetMsg = JSON.parse(e.data)

            if (msg.type === "snapshot") {
                snapshotBuffer.add(msg.data)
            }

            if (msg.type === "time") {
                netClock.sync(msg.serverTime)
            }
        }
    }

    sendInput(input: any) {
        this.socket?.send(JSON.stringify({ type: "input", data: input }))
    }

    startSendLoop(getInput: () => any) {
        setInterval(() => {
            this.sendInput(getInput())
        }, 1000 / this.tickRate)
    }

    updateRemotePlayers() {
        const renderTime = netClock.now() - this.interpolationDelay
        const result = snapshotBuffer.get(renderTime)
        if (!result || !("older" in result)) return

        const { older, newer, t } = result

        for (const oldP of older.players) {
            const newP = newer.players.find(p => p.id === oldP.id)
            if (!newP) continue

            this.players.set(oldP.id, interpTransform(oldP, newP, t))
        }
    }
}

export const networkManager = new NetworkManager()
