const IS_DEV = process.env.NODE_ENV === "development";

export class NetClock {
    // Current offset: serverTime = performance.now() + offset
    private offset = 0;
    private synced = false;
    private recentOffsets: number[] = [];
    private lastNow = 0;
    /**
     * Get the current estimated server time.
     * Uses performance.now() + offset for monotonic, drift-free time locally.
     */
    get now(): number {
        const current = performance.now() + this.offset;

        if (current < this.lastNow) {
            return this.lastNow; // nunca deixa voltar
        }

        this.lastNow = current;
        return current;
    }

    get isSynced(): boolean {
        return this.synced;
    }

    /**
     * Add a sample offset (serverTime - clientTime)
     */
    addSample(offset: number) {
        if (!this.synced) {
            this.offset = offset;
            this.synced = true;
            this.recentOffsets = [offset];
        } else {
            // Sliding window of offsets to reject outliers
            this.recentOffsets.push(offset);
            if (this.recentOffsets.length > 20) this.recentOffsets.shift();

            // Use median of recent offsets
            const sorted = [...this.recentOffsets].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];

            const diff = median - this.offset;

            // nunca snap, sempre drift
            this.offset += diff * 0.05;

            if (Math.abs(diff) > 500) {
                this.offset = median; // só snap se for absurdo
            } else {
                this.offset += diff * 0.05;
            }
        }
    }

    /**
     * Force set the offset (e.g. initial sync)
     */
    setOffset(offset: number) {
        this.offset = offset;
        this.synced = true;
        this.recentOffsets = [offset];
    }
}

export const netClock = new NetClock();
