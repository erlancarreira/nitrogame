import { io, Socket } from "socket.io-client";
import { Player } from "./types";
import type { GameSnapshot, PlayerInput } from "../../types/network";
import { Telemetry } from "./telemetry";
import { netClock } from "../netcode/netclock";

const IS_DEV = process.env.NODE_ENV === "development";
function devLog(...args: unknown[]) { if (IS_DEV) console.log(...args); }
function devWarn(...args: unknown[]) { if (IS_DEV) console.warn(...args); }

export type NetworkMessage =
    | { type: "JOIN_REQUEST"; player: Player }
    | { type: "JOIN_ACCEPT"; state: LobbyState }
    | { type: "LOBBY_UPDATE"; players: Player[]; settings: LobbySettings }
    | { type: "PLAYER_UPDATE"; player: Player }
    | { type: "START_GAME"; mapId: string; laps: number; players: Player[]; raceStartTime?: number }
    | { type: "KICK_PLAYER"; playerId: string }
    | { type: "POS"; id: string; p: [number, number, number]; r: number; s: number; l: number; t: number; seq?: number }
    | { type: "ITEM_HIT"; targetId: string; effect: "spinOut" | "oilSlip" | "boost"; itemId?: string; itemType?: "banana" | "oil" | "shell" }
    | { type: "PLAYER_FINISHED"; id: string; finishTime: number; lap: number }
    | { type: "SHELL_SPAWN"; shell: { id: string; ownerId: string; targetId: string | null; startPosition: [number, number, number]; startRotation: number } }
    | { type: "SHELL_DESPAWN"; shellId: string }
    | { type: "GAME_SNAPSHOT"; snapshot: GameSnapshot; lastProcessedFrame: number }
    // Entity Replication
    | { type: "REQUEST_WORLD_STATE" }
    | { type: "WORLD_STATE_SYNC"; shells: any[]; bananas: any[]; oils: any[] };

export interface LobbySettings {
    mapId: string;
    laps: number;
}

export interface LobbyState {
    players: Player[];
    settings: LobbySettings;
}

// ICE servers for WebRTC NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
    },
    {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
    },
    {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
    },
];

const envServer = process.env.NEXT_PUBLIC_GAME_SERVER;
// If running on a remote domain (e.g. Cloudflare) but config points to localhost, force relative URL to use proxy
const isLocalhostConfig = envServer?.includes("localhost") || envServer?.includes("127.0.0.1");
const isRunningRemote = typeof window !== "undefined" && window.location.hostname && !window.location.hostname.includes("localhost");

const SERVER_URL = (isRunningRemote && isLocalhostConfig)
    ? ""
    : (envServer || (IS_DEV ? "http://localhost:3001" : ""));


// ---- Binary POS Encoding (38 bytes vs ~120 JSON) ----
// Layout: [marker:1][id_len:1][id:N][x:4][y:4][z:4][rot:4][speed:4][lapProgress:4][timestamp:8][seq:2]
// Using Float32 for position/rotation/speed, Float64 for timestamp, Uint16 for sequence

const POS_HEADER = 0x50; // 'P' ASCII — magic byte to identify binary POS packets

function encodePosMessage(msg: { id: string; p: [number, number, number]; r: number; s: number; l: number; t: number; seq: number }): ArrayBuffer {
    const idBytes = new TextEncoder().encode(msg.id);
    const buf = new ArrayBuffer(2 + idBytes.length + 32 + 2); // Added 2 bytes for seq
    const view = new DataView(buf);
    let offset = 0;

    view.setUint8(offset++, POS_HEADER);
    view.setUint8(offset++, idBytes.length);
    new Uint8Array(buf, offset, idBytes.length).set(idBytes);
    offset += idBytes.length;

    view.setFloat32(offset, msg.p[0], true); offset += 4;
    view.setFloat32(offset, msg.p[1], true); offset += 4;
    view.setFloat32(offset, msg.p[2], true); offset += 4;
    view.setFloat32(offset, msg.r, true); offset += 4;
    view.setFloat32(offset, msg.s, true); offset += 4;
    view.setFloat32(offset, msg.l, true); offset += 4;
    view.setFloat64(offset, msg.t, true); offset += 8;
    view.setUint16(offset, msg.seq || 0, true); // offset += 2;

    return buf;
}

function decodePosMessage(buf: ArrayBuffer): { type: "POS"; id: string; p: [number, number, number]; r: number; s: number; l: number; t: number; seq: number } | null {
    const view = new DataView(buf);
    if (view.byteLength < 6 || view.getUint8(0) !== POS_HEADER) return null; // Min size check increased

    let offset = 0;
    offset++; // skip header
    const idLen = view.getUint8(offset++);
    const idBytes = new Uint8Array(buf, offset, idLen);
    const id = new TextDecoder().decode(idBytes);
    offset += idLen;

    const x = view.getFloat32(offset, true); offset += 4;
    const y = view.getFloat32(offset, true); offset += 4;
    const z = view.getFloat32(offset, true); offset += 4;
    const r = view.getFloat32(offset, true); offset += 4;
    const s = view.getFloat32(offset, true); offset += 4;
    const l = view.getFloat32(offset, true); offset += 4;
    const t = view.getFloat64(offset, true); offset += 8;

    // Safety check for old packets or malformed
    const seq = offset + 2 <= view.byteLength ? view.getUint16(offset, true) : 0;

    return { type: "POS", id, p: [x, y, z], r, s, l, t, seq };
}

export class NetworkManager {
    // Public API (same interface as before)
    myId: string = "";
    isHost: boolean = false;
    roomCode: string = "";

    // ── Event listeners (subscribe/unsubscribe pattern) ──
    private _messageListeners: Array<(msg: NetworkMessage) => void> = [];
    private _disconnectListeners: Array<(playerId: string) => void> = [];
    private _closeListeners: Array<() => void> = [];
    private _errorListeners: Array<(err: Error) => void> = [];
    private _tempDisconnectListeners: Array<() => void> = [];
    private _reconnectedListeners: Array<() => void> = [];

    /** Subscribe to incoming network messages. Returns unsubscribe function. */
    onMessage(listener: (msg: NetworkMessage) => void): () => void {
        this._messageListeners.push(listener);
        return () => { this._messageListeners = this._messageListeners.filter(l => l !== listener); };
    }

    /** Subscribe to player disconnect events. Returns unsubscribe function. */
    onPlayerDisconnected(listener: (playerId: string) => void): () => void {
        this._disconnectListeners.push(listener);
        return () => { this._disconnectListeners = this._disconnectListeners.filter(l => l !== listener); };
    }

    /** Subscribe to connection close events. Returns unsubscribe function. */
    onClose(listener: () => void): () => void {
        this._closeListeners.push(listener);
        return () => { this._closeListeners = this._closeListeners.filter(l => l !== listener); };
    }

    /** Subscribe to error events. Returns unsubscribe function. */
    onError(listener: (err: Error) => void): () => void {
        this._errorListeners.push(listener);
        return () => { this._errorListeners = this._errorListeners.filter(l => l !== listener); };
    }

    /** Subscribe to temporary disconnect (Socket.IO will auto-reconnect). Returns unsubscribe function. */
    onTemporaryDisconnect(listener: () => void): () => void {
        this._tempDisconnectListeners.push(listener);
        return () => { this._tempDisconnectListeners = this._tempDisconnectListeners.filter(l => l !== listener); };
    }

    /** Subscribe to successful reconnection. Returns unsubscribe function. */
    onReconnected(listener: () => void): () => void {
        this._reconnectedListeners.push(listener);
        return () => { this._reconnectedListeners = this._reconnectedListeners.filter(l => l !== listener); };
    }

    // ── Emit helpers (private) ─
    private emit(event: "message", msg: NetworkMessage): void;
    private emit(event: "playerDisconnected", playerId: string): void;
    private emit(event: "close" | "tempDisconnect" | "reconnected"): void;
    private emit(event: "error", err: Error): void;
    private emit(event: string, arg?: unknown): void {
        switch (event) {
            case "message": this._messageListeners.forEach(l => l(arg as NetworkMessage)); break;
            case "playerDisconnected": this._disconnectListeners.forEach(l => l(arg as string)); break;
            case "close": this._closeListeners.forEach(l => l()); break;
            case "error": this._errorListeners.forEach(l => l(arg as Error)); break;
            case "tempDisconnect": this._tempDisconnectListeners.forEach(l => l()); break;
            case "reconnected": this._reconnectedListeners.forEach(l => l()); break;
        }
    }

    // Internal
    private socket: Socket | null = null;
    private peerConnections = new Map<string, RTCPeerConnection>();
    private dataChannels = new Map<string, RTCDataChannel>();
    private webrtcReady = new Set<string>();

    // Clock synchronization (NTP-style)
    // removed local clockOffset/clockSynced, delegating to netClock

    // Ping measurement
    private _ping: number = -1; // -1 = not measured yet
    private _pingInterval: ReturnType<typeof setInterval> | null = null;

    constructor() { }

    /** Current ping (RTT) in ms. Returns -1 if not measured yet. */
    get ping(): number {
        return this._ping;
    }

    /** Start periodic ping measurement. Call after connection is established. */
    startPingLoop(intervalMs: number = 3000): void {
        this.stopPingLoop();
        // Measure immediately, then every intervalMs
        this.measurePing();
        this._pingInterval = setInterval(() => this.measurePing(), intervalMs);
    }

    /** Stop periodic ping measurement. */
    stopPingLoop(): void {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    private measurePing(): void {
        if (!this.socket) return;
        // Use performance.now() for accurate RTT locally
        const start = performance.now();
        this.socket.emit("ping-measure", (serverTime: number) => {
            const rtt = performance.now() - start;
            this._ping = rtt;
        });
    }

    /** Get estimated server time (performance.now() + offset). */
    getServerTime(): number {
        return netClock.now;
    }

    /** Get raw clock offset in ms. Positive = server clock is ahead of client. */
    getClockOffset(): number {
        // We can expose netClock's internal offset if needed, but usually just .now is enough
        // For backwards compat with UI/debug, we can return approximate
        return netClock.now - performance.now();
    }

    /** Whether clock sync has completed at least once. */
    isClockSynced(): boolean {
        return netClock.isSynced;
    }

    /**
     * NTP-style clock synchronization.
     * Sends `samples` ping/pong rounds to the server, measures RTT for each,
     * and uses the **median** offset (robust against outlier spikes).
     *
     * Should be called once during lobby phase — the offset is stable enough
     * for the duration of a race (~3-5 min).
     */
    async syncClock(samples: number = 5): Promise<number> {
        if (!this.socket) return 0;

        devLog(`[clock-sync] Starting with ${samples} samples...`);

        for (let i = 0; i < samples; i++) {
            try {
                const { serverTime, clientTime } = await this.pingServer();
                netClock.addSample(serverTime, clientTime);
                // Small delay between pings to avoid burst
                if (i < samples - 1) {
                    await new Promise(r => setTimeout(r, 150));
                }
            } catch {
                // Skip failed sample
            }
        }

        devLog(`[clock-sync] Done. Offset: ${this.getClockOffset().toFixed(1)}ms`);
        return this.getClockOffset();
    }

    private pingServer(): Promise<{ serverTime: number; clientTime: number }> {
        return new Promise((resolve, reject) => {
            if (!this.socket) return reject("no socket");

            // Use performance.now() for local monotonicity
            const clientSendTime = performance.now();
            const timeout = setTimeout(() => reject("timeout"), 3000);

            // Accessing internal socket to emit manually
            this.socket.emit("clock-sync-ping", clientSendTime, (res: { clientSendTime: number; serverTime: number }) => {
                clearTimeout(timeout);
                const clientRecvTime = performance.now();
                const rtt = clientRecvTime - clientSendTime;

                // Momento médio da viagem no clock local
                const clientMid = clientSendTime + rtt / 2;

                resolve({
                    serverTime: res.serverTime,
                    clientTime: clientMid,
                });
            });
        });
    }

    // Connect to Socket.IO server
    initialize(_id?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (this.socket?.connected) {
                resolve(this.myId);
                return;
            }

            this.socket = io(SERVER_URL, {
                transports: ["websocket"], // Force WebSocket only (no polling) for max performance
                reconnection: true,
                reconnectionAttempts: 5,
                timeout: 10000,
            });

            this.socket.once("connect", () => {
                this.myId = this.socket!.id!;
                devLog("[net] Socket connected:", this.myId);
                this.setupSocketListeners();
                // Start clock sync in background (ready before game starts)
                this.syncClock(5).catch(() => { /* non-critical */ });
                resolve(this.myId);
            });

            this.socket.on("connect_error", (err) => {
                devWarn("[net] Socket connection error:", err.message, SERVER_URL);
                this.emit("error", err);
                reject(err);
            });
        });
    }

    // Create a new room (host only)
    createRoom(playerProfile: Omit<Player, "id">): Promise<{ code: string; playerId: string }> {
        return new Promise((resolve, reject) => {
            if (!this.socket) return reject(new Error("Not connected"));
            type CreateRoomAck = {
                ok: true;
                code: string;
                playerId: string;
                players: Player[];
                settings: LobbySettings;
            } | { ok: false; error?: string };

            this.socket.emit("create-room", { player: playerProfile }, (res: CreateRoomAck) => {
                if (!res.ok) return reject(new Error(res.error || "Failed to create room"));
                this.roomCode = res.code;
                this.isHost = true;
                this.myId = res.playerId;
                devLog("[net] Room created:", res.code);
                resolve({ code: res.code, playerId: res.playerId });
            });
        });
    }

    // Join an existing room (replaces old connectToHost with peerId)
    connectToHost(roomCode: string, myPlayerProfile: Player): void {
        if (!this.socket) return;
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();

        type JoinRoomAck = {
            ok: true;
            playerId: string;
            players: Player[];
            settings: LobbySettings;
        } | { ok: false; error?: string };

        this.socket.emit("join-room", {
            code: this.roomCode,
            player: { ...myPlayerProfile, socketId: this.myId },
        }, (res: JoinRoomAck) => {
            if (!res.ok) {
                devWarn("[net] Join failed:", res.error);
                this.emit("error", new Error(res.error || "Failed to join room"));
                this.emit("close");
                return;
            }
            this.myId = res.playerId;
            devLog("[net] Joined room:", this.roomCode);
            // Server will emit lobby-update which triggers onMessage
        });
    }

    // Send player update to server
    emitPlayerUpdate(player: Partial<Player>): void {
        this.socket?.emit("player-update", { code: this.roomCode, player });
    }

    // Send settings update (host only)
    emitSettingsUpdate(settings: { mapId: string; laps: number }): void {
        this.socket?.emit("settings-update", { code: this.roomCode, settings });
    }

    // Start game (host only)
    emitStartGame(data: { mapId: string; laps: number; players: Player[] }): void {
        this.socket?.emit("start-game", { code: this.roomCode, ...data });
    }

    // Envia input de jogador (para prediction/reconciliation do servidor)
    emitPlayerInput(input: PlayerInput): void {
        this.socket?.volatile.emit("player-input", { roomCode: this.roomCode, input });
    }

    // Send message — POS goes via WebRTC (fallback Socket.IO), rest via Socket.IO
    sendToHost(msg: NetworkMessage): void {
        if (msg.type === "POS") {
            this.sendPosToAll(msg);
        } else {
            this.socket?.emit("reliable-msg", { code: this.roomCode, msg });
        }
    }

    broadcast(msg: NetworkMessage): void {
        if (msg.type === "POS") {
            this.sendPosToAll(msg);
        } else {
            this.socket?.emit("reliable-msg", { code: this.roomCode, msg });
        }
    }

    cleanup(): void {
        this.stopPingLoop();
        this._ping = -1;
        for (const [, pc] of this.peerConnections) {
            pc.close();
        }
        this.peerConnections.clear();
        this.dataChannels.clear();
        this.webrtcReady.clear();
        // Clear all listeners to prevent stale references
        this._messageListeners = [];
        this._disconnectListeners = [];
        this._closeListeners = [];
        this._errorListeners = [];
        this._tempDisconnectListeners = [];
        this._reconnectedListeners = [];
        this.socket?.disconnect();
        this.socket = null;
        this.myId = "";
        this.isHost = false;
        this.roomCode = "";
    }

    // ---- Private: Send POS via WebRTC mesh (fallback Socket.IO relay) ----

    private sendPosToAll(msg: NetworkMessage): void {
        if (msg.type !== "POS") return;

        // Try binary via WebRTC first (lower latency + smaller packets)
        const binary = encodePosMessage({ ...msg, seq: msg.seq || 0 });

        for (const [, dc] of this.dataChannels) {
            if (dc.readyState === "open") {
                try {
                    dc.send(binary);
                } catch { /* fall through to relay */ }
            }
        }

        // Always relay via server so peers without RTC still receive updates.
        // Remote clients dedupe by timestamp per id.
        this.socket?.volatile.emit("pos-relay", binary);
    }

    // ---- Private: Socket.IO Event Listeners ----

    private setupSocketListeners(): void {
        if (!this.socket) return;

        // Lobby updates from server
        this.socket.on("lobby-update", (data: { players: Array<Record<string, unknown>>; settings: LobbySettings }) => {
            this.emit("message", {
                type: "LOBBY_UPDATE",
                players: data.players.map((p) => ({ ...p, id: (p.socketId || p.id) as string })) as Player[],
                settings: data.settings,
            });
        });

        // Game start (includes server-authoritative race start timestamp)
        this.socket.on("game-start", (data: { mapId: string; laps: number; players: Array<Record<string, unknown>>; raceStartTime?: number }) => {
            const players = data.players.map((p) => ({ ...p, id: (p.socketId || p.id) as string })) as Player[];
            this.emit("message", {
                type: "START_GAME",
                mapId: data.mapId,
                laps: data.laps,
                players,
                raceStartTime: data.raceStartTime,
            });
            // Initiate WebRTC mesh with all human players after game starts
            const humanRemotes = players.filter((p) => !p.isBot && p.id !== this.myId);
            this.initiateWebRTCMesh(humanRemotes);
        });

        // Authoritative game snapshots from server
        this.socket.on("game-snapshot", (data: { snapshot: GameSnapshot; lastProcessedFrame: number }) => {
            this.emit("message", {
                type: "GAME_SNAPSHOT",
                snapshot: data.snapshot,
                lastProcessedFrame: data.lastProcessedFrame,
            });
        });

        // Reliable message relay
        this.socket.on("reliable-msg", (msg: NetworkMessage) => {
            this.emit("message", msg);
        });

        // POS relay fallback
        this.socket.on("pos-relay", (msg: NetworkMessage | ArrayBuffer) => {
            if (msg instanceof ArrayBuffer) {
                const decoded = decodePosMessage(msg);
                if (decoded) {
                    this.emit("message", decoded);
                    return;
                }
            }
            this.emit("message", msg as NetworkMessage);
        });

        // Player disconnected
        this.socket.on("player-disconnected", (data: { playerId: string }) => {
            this.closePeerConnection(data.playerId);
            this.emit("playerDisconnected", data.playerId);
        });

        // Kicked from room
        this.socket.on("kicked", () => {
            this.emit("close");
        });

        // Socket disconnect — differentiate temporary vs permanent
        this.socket.on("disconnect", (reason) => {
            // "io server disconnect" = server kicked us, won't reconnect
            // "io client disconnect" = we called disconnect(), won't reconnect
            if (reason === "io server disconnect" || reason === "io client disconnect") {
                this.emit("close");
            } else {
                // Transport error, ping timeout, etc — Socket.IO will auto-reconnect
                devWarn("[net] Temporary disconnect:", reason);
                this.emit("tempDisconnect");
            }
        });

        // Socket.IO reconnected — rejoin room to restore server state
        this.socket.on("connect", () => {
            if (this.roomCode && this.myId) {
                devLog("[net] Reconnected, rejoining room:", this.roomCode);
                this.socket?.emit("rejoin-room", {
                    code: this.roomCode,
                    playerId: this.myId,
                }, (res: { ok?: boolean; playerId?: string; error?: string }) => {
                    if (res?.ok) {
                        // Socket.IO assigns new ID on reconnect
                        const oldId = this.myId;
                        this.myId = res.playerId || this.socket!.id!;
                        devLog("[net] Rejoined room successfully, new id:", this.myId, "(was", oldId, ")");
                        this.emit("reconnected");
                    } else {
                        devWarn("[net] Rejoin failed:", res?.error);
                        this.emit("close");
                    }
                });
            }
        });

        // ---- WebRTC Signaling ----

        this.socket.on("rtc-offer", async (data: { fromId: string; offer: RTCSessionDescriptionInit }) => {
            try {
                const pc = this.getOrCreatePeerConnection(data.fromId);
                await pc.setRemoteDescription(data.offer);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.socket?.emit("rtc-answer", { targetId: data.fromId, answer });
            } catch (err) {
                devWarn("[webrtc] Failed to handle offer from", data.fromId, err);
            }
        });

        this.socket.on("rtc-answer", async (data: { fromId: string; answer: RTCSessionDescriptionInit }) => {
            try {
                const pc = this.peerConnections.get(data.fromId);
                if (pc) await pc.setRemoteDescription(data.answer);
            } catch (err) {
                devWarn("[webrtc] Failed to handle answer from", data.fromId, err);
            }
        });

        this.socket.on("rtc-ice-candidate", async (data: { fromId: string; candidate: RTCIceCandidateInit }) => {
            try {
                const pc = this.peerConnections.get(data.fromId);
                if (pc) await pc.addIceCandidate(data.candidate);
            } catch { /* ignore late candidates */ }
        });
    }

    // ---- Private: WebRTC Mesh ----

    private async initiateWebRTCMesh(remotePlayers: Player[]): Promise<void> {
        for (const remote of remotePlayers) {
            const remoteId = remote.id;
            // Deterministic: lower socket.id sends the offer (avoids duplicate offers)
            if (this.myId < remoteId) {
                await this.createOffer(remoteId);
            }
            // Otherwise, wait for offer from the other side
        }
    }

    private async createOffer(remoteId: string): Promise<void> {
        try {
            const pc = this.getOrCreatePeerConnection(remoteId);
            // Offerer creates the DataChannel
            const dc = pc.createDataChannel("pos", {
                ordered: false,
                maxRetransmits: 0, // Unreliable — UDP-like
            });
            this.setupDataChannel(dc, remoteId);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.socket?.emit("rtc-offer", { targetId: remoteId, offer });
        } catch (err) {
            devWarn("[webrtc] Failed to create offer for", remoteId, err);
        }
    }

    private getOrCreatePeerConnection(remoteId: string): RTCPeerConnection {
        if (this.peerConnections.has(remoteId)) {
            return this.peerConnections.get(remoteId)!;
        }

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket?.emit("rtc-ice-candidate", {
                    targetId: remoteId,
                    candidate: event.candidate,
                });
            }
        };

        pc.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, remoteId);
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === "failed" || state === "disconnected" || state === "closed") {
                devWarn(`[webrtc] Connection to ${remoteId}: ${state}. Using Socket.IO relay.`);
                this.webrtcReady.delete(remoteId);
                this.dataChannels.delete(remoteId);
            }
        };

        this.peerConnections.set(remoteId, pc);
        return pc;
    }

    private setupDataChannel(dc: RTCDataChannel, remoteId: string): void {
        dc.binaryType = "arraybuffer";

        dc.onopen = () => {
            devLog(`[webrtc] DataChannel open with ${remoteId}`);
            this.dataChannels.set(remoteId, dc);
            this.webrtcReady.add(remoteId);
        };

        dc.onmessage = (event) => {
            try {
                // Binary POS messages (ArrayBuffer) — fast path
                if (event.data instanceof ArrayBuffer) {
                    const msg = decodePosMessage(event.data);
                    if (msg) {
                        this.emit("message", msg);
                        return;
                    }
                }
                // JSON fallback for non-POS messages
                const msg = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data)) as NetworkMessage;
                this.emit("message", msg);
            } catch { /* ignore malformed */ }
        };

        dc.onclose = () => {
            devLog(`[webrtc] DataChannel closed with ${remoteId}`);
            this.dataChannels.delete(remoteId);
            this.webrtcReady.delete(remoteId);
        };

        dc.onerror = () => {
            this.dataChannels.delete(remoteId);
            this.webrtcReady.delete(remoteId);
        };
    }

    private closePeerConnection(remoteId: string): void {
        const pc = this.peerConnections.get(remoteId);
        if (pc) pc.close();
        this.peerConnections.delete(remoteId);
        this.dataChannels.delete(remoteId);
        this.webrtcReady.delete(remoteId);
    }
}

export const networkManager = new NetworkManager();
