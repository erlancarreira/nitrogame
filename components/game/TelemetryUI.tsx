
import React, { useEffect, useState } from 'react';
import { Telemetry } from '@/lib/game/telemetry';
import { debugLogger } from '@/lib/debug/logger';

export function TelemetryUI() {
    const [metrics, setMetrics] = useState({
        fps: 0,
        rtt: 0,
        jitter: 0,
        loss: 0,
        pps: 0,
        bps: 0,
        buffer: 0,
        extrap: false,
        delay: 0,
        snaps: 0,
        drops: 0
    });

    useEffect(() => {
        const interval = setInterval(() => {
            setMetrics({
                fps: Telemetry.simulation.fps,
                rtt: Telemetry.network.rtt,
                jitter: Telemetry.network.jitter,
                loss: Telemetry.network.packetLoss,
                pps: Telemetry.network.packetsPerSec,
                bps: Telemetry.network.bytesPerSec,
                buffer: Telemetry.replication.bufferSize,
                extrap: Telemetry.replication.extrapolating,
                delay: Telemetry.replication.interpolationDelay,
                snaps: Telemetry.replication.snapshotsReceived,
                drops: Telemetry.replication.snapshotsDiscarded
            });
            // Reset per-second counters
            Telemetry.network.packetsPerSec = 0;
            Telemetry.network.bytesPerSec = 0;
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div style={{
            position: 'absolute',
            top: 10,
            left: 10,
            background: 'rgba(0,0,0,0.8)',
            color: '#0f0',
            fontFamily: 'monospace',
            padding: '10px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 9999
        }}>
            <div>=== TELEMETRY ===</div>
            <div>FPS: {metrics.fps}</div>
            <div>--- NETWORK ---</div>
            <div>RTT: {metrics.rtt.toFixed(1)}ms</div>
            <div>Jitter: {metrics.jitter.toFixed(1)}ms</div>
            <div>PPS: {metrics.pps}</div>
            <div>BPS: {(metrics.bps / 1024).toFixed(1)} KB/s</div>
            <div>Loss: {metrics.loss}%</div>
            <div>--- REPLICATION ---</div>
            <div>Buffer: {metrics.buffer}</div>
            <div>Delay: {metrics.delay.toFixed(0)}ms</div>
            <div>Snaps/Sec: {metrics.snaps}</div>
            <div>Drops: {metrics.drops}</div>
            <div style={{ color: metrics.extrap ? 'red' : 'green' }}>
                STATUS: {metrics.extrap ? 'EXTRAPOLATING (LAG)' : 'OK'}
            </div>

            <div style={{ pointerEvents: 'auto', marginTop: '10px', display: 'flex', gap: '5px' }}>
                <button
                    onClick={() => {
                        const rec = debugLogger.toggle();
                        console.log(rec ? "Recording..." : "Stopped.");
                    }}
                    style={{
                        background: '#500',
                        color: '#fff',
                        border: '1px solid #f00',
                        cursor: 'pointer',
                        fontSize: '10px',
                        padding: '2px 5px',
                    }}
                >
                    REC/STOP
                </button>

                <button
                    onClick={() => debugLogger.download()}
                    style={{
                        background: '#333',
                        color: '#fff',
                        border: '1px solid #666',
                        cursor: 'pointer',
                        fontSize: '10px',
                        padding: '2px 5px',
                    }}
                >
                    DOWNLOAD
                </button>
            </div>
        </div>
    );
}
