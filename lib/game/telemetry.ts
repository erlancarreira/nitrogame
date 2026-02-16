
export interface MetricBuffer {
    values: number[];
    maxSize: number;
}

export interface NetworkStats {
    rtt: number;
    jitter: number;
    packetsPerSec: number;
    bytesPerSec: number;
    packetLoss: number;
    outOfOrder: number;
    lastPacketTime: number;
}

export interface SimulationStats {
    fps: number;
    deltaTime: number;
    accumulator: number;
    physicsSteps: number;
    entityCount: number;
}

export interface ReplicationStats {
    snapshotsReceived: number;
    snapshotsDiscarded: number;
    bufferSize: number;
    extrapolating: boolean;
    interpolationDelay: number;
}

class TelemetrySystem {
    network: NetworkStats = { rtt: 0, jitter: 0, packetsPerSec: 0, bytesPerSec: 0, packetLoss: 0, outOfOrder: 0, lastPacketTime: 0 };
    simulation: SimulationStats = { fps: 0, deltaTime: 0, accumulator: 0, physicsSteps: 0, entityCount: 0 };
    replication: ReplicationStats = { snapshotsReceived: 0, snapshotsDiscarded: 0, bufferSize: 0, extrapolating: false, interpolationDelay: 0 };

    private logs: string[] = [];
    private history: any[] = [];

    log(category: string, message: string, data?: any) {
        const timestamp = performance.now();
        const entry = { t: timestamp.toFixed(2), cat: category, msg: message, data };
        this.history.push(entry);

        // Console output for debug
        // console.log(`[${category}] ${message}`, data || '');

        if (category === 'CRITICAL') {
            console.warn(`[CRITICAL] ${message}`, data);
        }

        // Cap history size to prevent memory crash (e.g. 50k entries)
        if (this.history.length > 50000) this.history.shift();
    }

    detectAnomaly(event: string) {
        if (this.simulation.accumulator > 0.1) this.log("CRITICAL", "STARVATION_DETECTION", { acc: this.simulation.accumulator });
        if (this.network.jitter > 50) this.log("WARN", "HIGH_JITTER", { jitter: this.network.jitter });
        if (this.replication.extrapolating) this.log("WARN", "EXTRAPOLATING");
    }

    updateNetwork(rtt: number, seq: number) {
        // Jitter calc logic could go here
        this.network.rtt = rtt;
    }

    downloadLogs() {
        const data = {
            agent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            network: this.network,
            simulation: this.simulation,
            replication: this.replication,
            logs: this.history
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `telemetry_dump_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

export const Telemetry = new TelemetrySystem();
