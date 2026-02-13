export class NetClock {
    offset = 0

    sync(serverTime: number) {
        const now = performance.now()
        this.offset = serverTime - now
    }

    now() {
        return performance.now() + this.offset
    }
}

export const netClock = new NetClock()
