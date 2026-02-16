const IS_DEV = process.env.NODE_ENV === "development";

/**
 * NetClock - Sincronização de tempo entre cliente e servidor
 * 
 * IMPORTANTE: Todos os timestamps devem estar no mesmo domínio de tempo.
 * O servidor envia Date.now() (epoch time), e o cliente deve converter
 * para performance.now() space usando o offset calculado.
 * 
 * serverTime = performance.now() + offset (onde offset ~= Date.now() - performance.now())
 */

export class NetClock {
    // Offset: serverTime = performance.now() + offset
    private offset = 0;
    private synced = false;
    private recentOffsets: number[] = [];
    private lastNow = 0;
    
    /**
     * Get the current estimated server time.
     * Usa performance.now() + offset para tempo monotônico e livre de drift.
     * 
     * Este é o tempo que deve ser usado para:
     * - Timestamps em mensagens de rede (POS, snapshots)
     * - Cálculos de interpolação/render time
     * - Sincronização de estado do jogo
     */
    get now(): number {
        const current = performance.now() + this.offset;

        // Garante que o tempo nunca volte (monotonic)
        if (current < this.lastNow) {
            return this.lastNow;
        }

        this.lastNow = current;
        return current;
    }

    /**
     * Converte um timestamp do servidor (Date.now()) para o espaço local
     * Útil quando recebemos timestamps de outros clientes via relay
     */
    serverToLocal(serverTimestamp: number): number {
        // serverTimestamp é Date.now() de outro cliente
        // Precisamos convertê-lo para nosso espaço de tempo local
        const nowServer = this.now;
        const nowLocal = performance.now();
        const serverToLocalDiff = nowServer - nowLocal;
        
        return serverTimestamp - serverToLocalDiff;
    }

    /**
     * Converte um timestamp local para o espaço do servidor
     * Útil quando enviamos timestamps para outros clientes
     */
    localToServer(localTimestamp: number): number {
        const nowServer = this.now;
        const nowLocal = performance.now();
        const serverToLocalDiff = nowServer - nowLocal;
        
        return localTimestamp + serverToLocalDiff;
    }

    get isSynced(): boolean {
        return this.synced;
    }

    /**
     * Add a sample offset (serverTime - clientTime)
     * serverTime é Date.now() do servidor
     * clientTime é performance.now() do cliente
     */
    addSample(serverTime: number, clientTime: number) {
        const offset = serverTime - clientTime;
        
        if (!this.synced) {
            this.offset = offset;
            this.synced = true;
            this.recentOffsets = [offset];
            if (IS_DEV) {
                console.log(`[netclock] Initial sync: offset=${offset.toFixed(2)}ms`);
            }
        } else {
            // Sliding window of offsets to reject outliers
            this.recentOffsets.push(offset);
            if (this.recentOffsets.length > 20) this.recentOffsets.shift();

            // Use median of recent offsets
            const sorted = [...this.recentOffsets].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];

            const diff = median - this.offset;

            // Nunca snap, sempre drift (exceto se for muito grande)
            if (Math.abs(diff) > 500) {
                this.offset = median; // só snap se for absurdo
                if (IS_DEV) {
                    console.log(`[netclock] Large offset correction: ${diff.toFixed(2)}ms`);
                }
            } else {
                // Suaviza a transição (5% por amostra)
                this.offset += diff * 0.05;
            }
        }
    }

    /**
     * Force set the offset (e.g. initial sync)
     */
    setOffset(serverTime: number, clientTime: number) {
        this.offset = serverTime - clientTime;
        this.synced = true;
        this.recentOffsets = [this.offset];
    }
}

export const netClock = new NetClock();
