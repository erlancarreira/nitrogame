

export interface LogEntry {
    frame: number;
    timestamp: number;
    type: "local" | "remote" | "server_correction" | "input" | "shadow_physics";
    id?: string;
    pos?: { x: number; y: number; z: number };
    rot?: number;
    vel?: { x: number; y: number; z: number };
    serverPos?: { x: number; y: number; z: number };
    delta?: number;
    meta?: any;
}

class DebugLogger {
    private logs: LogEntry[] = [];
    private maxLogs = 5000;
    private isRecording = true; // Auto-start
    private uploadUrl = "http://localhost:3001/logs";

    constructor() {
        console.log("[DebugLogger] Auto-started recording.");
        // Auto-save every 30 seconds
        setInterval(() => {
            if (this.logs.length > 0) {
                this.upload();
            }
        }, 30000);
    }

    start() {
        this.isRecording = true;
        this.logs = [];
        console.log("[DebugLogger] Started recording");
    }

    stop() {
        this.isRecording = false;
        console.log("[DebugLogger] Stopped recording. Entries:", this.logs.length);
        this.upload(); // Auto-upload on stop
    }

    toggle() {
        if (this.isRecording) this.stop();
        else this.start();
        return this.isRecording;
    }

    log(entry: Omit<LogEntry, "timestamp">) {
        if (!this.isRecording) return;

        if (this.logs.length >= this.maxLogs) {
            this.logs.shift(); // Keep rolling buffer
        }

        this.logs.push({
            ...entry,
            timestamp: performance.now(),
        });
    }

    async upload() {
        if (this.logs.length === 0) return;

        console.log("[DebugLogger] Uploading logs...", this.logs.length);
        const data = JSON.stringify(this.logs, null, 2);

        try {
            const res = await fetch(this.uploadUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: data
            });
            if (res.ok) {
                const json = await res.json();
                console.log("[DebugLogger] Logs saved to server:", json.filename);
                // Optional: Clear logs after save to save memory? 
                // Or keep for rolling? 
                // If we clear, we lose context. If we don't, we re-upload duplicates.
                // Let's clear.
                this.logs = [];
            } else {
                console.error("[DebugLogger] Upload failed:", res.statusText);
            }
        } catch (e) {
            console.error("[DebugLogger] Upload error:", e);
        }
    }

    download() {
        // ... keep for fallback
        const data = JSON.stringify(this.logs, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mariokart-debug-log-${new Date().toISOString().replace(/:/g, "-")}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log("[DebugLogger] Downloaded logs");
    }
}

export const debugLogger = new DebugLogger();

