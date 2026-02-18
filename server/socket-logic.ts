import { Server, Socket } from "socket.io";
import type { PlayerInput, GameSnapshot, PlayerState } from "../types/network";
import {
    KartPhysicsState,
    createPhysicsState,
    updateKartPhysics,
    stateToPlayerState,
    normalizeInput,
} from "../lib/game/kart-physics-core";
import { MAPS } from "../lib/game/maps";

// ---- Types ----

interface RoomPlayer {
    socketId: string;
    name: string;
    color: string;
    modelUrl?: string;
    modelPackId?: string;
    isBot: boolean;
    isHost: boolean;
    isReady: boolean;
    // Added for spatial culling
    lastPos?: { x: number; y: number; z: number };
}

type RoomGameState = "lobby" | "countdown" | "racing" | "finished";

/** Cooldown entre start-game consecutivos para evitar double-click (ms) */
const REMATCH_COOLDOWN_MS = 5_000;

interface Room {
    code: string;
    hostSocketId: string;
    players: RoomPlayer[];
    settings: { mapId: string; laps: number };
    gameState: RoomGameState;
    gameConfig?: { mapId: string; laps: number; raceStartTime: number; initiatedAt: number };
}

// Simulation types for authoritative server
interface SimPlayer {
    physics: KartPhysicsState;
    inputs: PlayerInput[];
    lastProcessedFrame: number;
    lastInput?: any; // KartInputState
}

interface RoomSimulation {
    roomCode: string;
    frame: number;
    lastSnapshotAt: number;
    players: Map<string, SimPlayer>; // key = socketId
}

const rooms = new Map<string, Room>();
const roomSims = new Map<string, RoomSimulation>();

// O(1) lookup: socketId -> roomCode
const socketIdMap = new Map<string, string>();

// ---- Rate Limiting (per-socket) ----

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

const RATE = {
    lobby: { limit: 30, intervalMs: 10_000 },        // create/join/update/settings/start
    signaling: { limit: 300, intervalMs: 10_000 },   // WebRTC offer/answer/ICE, reliable msgs
    posRelay: { limit: 600, intervalMs: 10_000 },    // Fallback POS relay (≈60/s)
    clock: { limit: 120, intervalMs: 10_000 },       // clock-sync pings
    input: { limit: 1200, intervalMs: 10_000 },      // player-input events (≈120/s)
};

function allowRate(socket: Socket, key: string, limit: number, intervalMs: number): boolean {
    const bucketKey = `${socket.id}:${key}`;
    const now = Date.now();
    const bucket = rateBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
        rateBuckets.set(bucketKey, { count: 1, resetAt: now + intervalMs });
        return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
}

function guard(socket: Socket, key: string, conf: { limit: number; intervalMs: number }): boolean {
    const ok = allowRate(socket, key, conf.limit, conf.intervalMs);
    if (!ok) {
        console.warn(`[rate-limit] socket=${socket.id} event=${key}`);
        socket.emit("rate-limit", { event: key });
    }
    return ok;
}

// ---- Helpers ----

// Input Validation Constants
const MAX_NAME_LENGTH = 20;
const COLOR_REGEX = /^#[0-9a-fA-F]{3,8}$/;
const VALID_MAP_IDS = ["green-valley", "sunset-circuit", "frost-peak", "neon-nights", "volcano-rush", "crystal-caves", "cyber-loop", "cartoon-race-track-oval"];
const VALID_LAPS = [1, 2, 3, 5, 10];
const MAX_ROOM_CODE_ATTEMPTS = 50;

function sanitizeName(name: unknown): string {
    if (typeof name !== "string") return "Player";
    return name.trim().slice(0, MAX_NAME_LENGTH) || "Player";
}

function sanitizeColor(color: unknown): string | undefined {
    if (typeof color !== "string") return undefined;
    return COLOR_REGEX.test(color) ? color : undefined;
}

function sanitizeMapId(mapId: unknown): string {
    if (typeof mapId === "string" && VALID_MAP_IDS.includes(mapId)) return mapId;
    return "green-valley";
}

function sanitizeLaps(laps: unknown): number {
    if (typeof laps === "number" && VALID_LAPS.includes(laps)) return laps;
    return 3;
}

function generateRoomCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
        let code = "";
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        if (!rooms.has(code)) return code;
    }
    return Date.now().toString(36).toUpperCase().slice(-6);
}

function getRoomBySocket(socketId: string): Room | undefined {
    const code = socketIdMap.get(socketId);
    return code ? rooms.get(code) : undefined;
}

function removePlayerFromRoom(io: Server, room: Room, socketId: string): void {
    room.players = room.players.filter(p => p.socketId !== socketId);
    socketIdMap.delete(socketId);

    // Remove from simulation state as well
    const sim = roomSims.get(room.code);
    if (sim) {
        sim.players.delete(socketId);
        if (sim.players.size === 0) {
            roomSims.delete(room.code);
            console.log(`[sim] RoomSim ${room.code} deleted (no players)`);
        }
    }

    if (room.players.length === 0) {
        rooms.delete(room.code);
        console.log(`[room] Room ${room.code} deleted (empty)`);
        return;
    }

    // If host left, promote next human player
    if (room.hostSocketId === socketId) {
        const newHost = room.players.find(p => !p.isBot);
        if (newHost) {
            room.hostSocketId = newHost.socketId;
            newHost.isHost = true;
            console.log(`[room] New host for ${room.code}: ${newHost.socketId}`);
        }
    }

    io.to(room.code).emit("lobby-update", {
        players: room.players,
        settings: room.settings,
    });
    io.to(room.code).emit("player-disconnected", { playerId: socketId });
}

// ---- Simulation helpers ----

const SIM_RATE = 60; // Hz
const SIM_DT_MS = 1000 / SIM_RATE;
const SNAPSHOT_RATE = 20; // Hz
const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_RATE;

function ensureRoomSimulation(room: Room): RoomSimulation {
    let sim = roomSims.get(room.code);
    if (!sim) {
        sim = {
            roomCode: room.code,
            frame: 0,
            lastSnapshotAt: Date.now(),
            players: new Map<string, SimPlayer>(),
        };
        roomSims.set(room.code, sim);
    } else {
        // Reset for new race
        sim.frame = 0;
        sim.lastSnapshotAt = Date.now();
        sim.players.clear();
    }

    // Initialize players physics state
    const map = MAPS.find(m => m.id === room.settings.mapId) || MAPS[0];

    room.players.forEach((player, index) => {
        // Skip Bots — they are simulated by the Host client and synced via POS relay.
        // If we simulate them here with no inputs, we will broadcast "neutral/stopped" states
        // that conflict with the Host's authoritative updates, causing flickering.
        if (player.isBot) return;

        // Use actual spawn positions from track config.
        const startPos = map.startPositions[index] || [0, 2, 0];
        // Green Valley (and others) might have specific start rotation
        const startRot = map.startRotation ?? 0;

        const physics = createPhysicsState(startPos as [number, number, number], startRot);
        sim.players.set(player.socketId, {
            physics,
            inputs: [],
            lastProcessedFrame: 0,
        });
    });

    console.log(`[sim] Initialized simulation for room ${room.code} with ${room.players.length} players`);
    return sim;
}

// Distance culling: players > 300 units away don't get updates (saves bandwidth)
// Increased to 5000 units to support Green Valley and other large maps without disappearance
const BROADCAST_RADIUS_SQ = 5000 * 5000;

function decodePosHeader(buffer: Buffer): { x: number, y: number, z: number } | null {
    if (buffer.length < 10 || buffer[0] !== 0x50) return null;
    try {
        let offset = 1;
        const idLen = buffer[offset];
        offset += 1 + idLen; // Skip ID
        if (offset + 12 > buffer.length) return null;
        const x = buffer.readFloatLE(offset);
        const y = buffer.readFloatLE(offset + 4);
        const z = buffer.readFloatLE(offset + 8);
        return { x, y, z };
    } catch (e) {
        return null;
    }
}

// ---- Initialization Function ----

export function setupSocketIO(io: Server) {
    // Start Simulation Loop
    // This runs once for the entire server (handling all room simulations)
    setInterval(() => {
        const now = Date.now();

        // Transição automática de estado: countdown → racing
        for (const room of rooms.values()) {
            if (room.gameState === "countdown" && room.gameConfig && now >= room.gameConfig.raceStartTime) {
                room.gameState = "racing";
            }
        }

        for (const sim of roomSims.values()) {
            try {
                sim.frame += 1;

                // Update physics
                for (const [socketId, simPlayer] of sim.players) {
                    const { physics } = simPlayer;
                    const inputs = simPlayer.inputs;

                    if (inputs.length > 0) {
                        inputs.sort((a, b) => a.frame - b.frame);
                        for (const input of inputs) {
                            if (input.frame <= simPlayer.lastProcessedFrame) continue;
                            const physInput = normalizeInput({
                                throttle: input.throttle,
                                steer: input.steer,
                                brake: input.brake,
                                drift: input.drift,
                                useItem: input.useItem,
                            });
                            updateKartPhysics(physics, physInput, SIM_DT_MS / 1000);
                            simPlayer.lastProcessedFrame = input.frame;
                            simPlayer.lastInput = physInput; // Save last valid input
                        }
                        simPlayer.inputs = [];
                    } else {
                        // No new input? Use last known input (Input Persistence)
                        // This prevents "braking" simulation if a packet arrives 1ms late or if client is 30Hz
                        const stickyInput = simPlayer.lastInput || normalizeInput({ throttle: 0, steer: 0, brake: false, drift: false, useItem: false });
                        updateKartPhysics(physics, stickyInput, SIM_DT_MS / 1000);
                    }
                }

                // Send snapshots
                if (now - sim.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
                    const playersState: Record<string, PlayerState> = {};
                    for (const [socketId, simPlayer] of sim.players) {
                        playersState[socketId] = stateToPlayerState(socketId, simPlayer.physics, sim.frame, now);
                    }
                    const snapshot: GameSnapshot = {
                        frame: sim.frame,
                        serverTime: now,
                        players: playersState,
                    };
                    for (const [socketId, simPlayer] of sim.players) {
                        io.to(socketId).emit("game-snapshot", {
                            snapshot,
                            lastProcessedFrame: simPlayer.lastProcessedFrame,
                        });
                    }
                    sim.lastSnapshotAt = now;
                }
            } catch (err) {
                console.error(`[sim] Error in simulation loop for room ${sim.roomCode}:`, err);
            }
        }
    }, SIM_DT_MS);

    io.on("connection", (socket: Socket) => {
        console.log(`[connect] ${socket.id}`);

        // --- CLOCK SYNC ---
        socket.on("clock-sync-ping", (clientSendTime: number, ack: Function) => {
            if (!guard(socket, "clock-sync", RATE.clock)) {
                ack?.({ clientSendTime, serverTime: Date.now(), rateLimited: true });
                return;
            }
            const serverNow = Date.now();
            ack({ clientSendTime, serverTime: serverNow });
        });

        // --- PING MEASUREMENT ---
        socket.on("ping-measure", (ack: Function) => {
            ack?.(Date.now());
        });

        // --- CREATE ROOM ---
        socket.on("create-room", (data: { player: Omit<RoomPlayer, "socketId"> }, ack: Function) => {
            if (!guard(socket, "create-room", RATE.lobby)) return ack({ ok: false, error: "rate-limited" });
            const code = generateRoomCode();
            const player: RoomPlayer = {
                ...data.player,
                name: sanitizeName(data.player?.name),
                color: sanitizeColor(data.player?.color) || "#ff4444",
                socketId: socket.id,
                isHost: true,
                isReady: false, // Default not ready
            };
            const room: Room = {
                code,
                hostSocketId: socket.id,
                players: [player],
                settings: { mapId: "green-valley", laps: 3 },
                gameState: "lobby",
            };
            rooms.set(code, room);
            socketIdMap.set(socket.id, code); // Cache lookup
            socket.join(code);
            console.log(`[room] ${socket.id} created room ${code}`);
            ack({
                ok: true,
                code,
                playerId: socket.id,
                players: room.players,
                settings: room.settings,
            });
        });

        // --- JOIN ROOM ---
        socket.on("join-room", (data: { code: string; player: Omit<RoomPlayer, "socketId"> }, ack: Function) => {
            if (!guard(socket, "join-room", RATE.lobby)) return ack({ ok: false, error: "rate-limited" });
            const code = data.code.toUpperCase();
            const room = rooms.get(code);
            if (!room) {
                ack({ ok: false, error: "Room not found" });
                return;
            }
            if (room.gameState !== "lobby") {
                ack({ ok: false, error: "Game already started" });
                return;
            }
            if (room.players.length >= 8) {
                ack({ ok: false, error: "Room is full" });
                return;
            }
            const player: RoomPlayer = {
                ...data.player,
                name: sanitizeName(data.player?.name),
                color: sanitizeColor(data.player?.color) || "#4488ff",
                socketId: socket.id,
                isHost: false,
                isReady: false,
            };
            room.players.push(player);
            socketIdMap.set(socket.id, code); // Cache lookup
            socket.join(code);
            console.log(`[room] ${socket.id} joined room ${code}`);
            ack({
                ok: true,
                playerId: socket.id,
                players: room.players,
                settings: room.settings,
            });
            io.to(room.code).emit("lobby-update", {
                players: room.players,
                settings: room.settings,
            });
        });

        // --- REJOIN ROOM ---
        socket.on("rejoin-room", (data: { code: string; playerId: string }, ack: Function) => {
            if (!guard(socket, "rejoin-room", RATE.lobby)) return ack({ ok: false, error: "rate-limited" });
            const code = data.code.toUpperCase();
            const room = rooms.get(code);
            if (!room) {
                ack({ ok: false, error: "Room no longer exists" });
                return;
            }
            const existingIdx = room.players.findIndex(p => p.socketId === data.playerId);
            if (existingIdx !== -1) {
                const oldSocketId = room.players[existingIdx].socketId;
                room.players[existingIdx].socketId = socket.id;
                if (room.hostSocketId === data.playerId) {
                    room.hostSocketId = socket.id;
                }

                // Migrate simulation state to new socket ID (Socket.IO assigns new ID on reconnect)
                const sim = roomSims.get(code);
                if (sim) {
                    const simPlayer = sim.players.get(oldSocketId);
                    if (simPlayer) {
                        sim.players.delete(oldSocketId);
                        sim.players.set(socket.id, simPlayer);
                        console.log(`[sim] Migrated SimPlayer ${oldSocketId} -> ${socket.id}`);
                    }
                }
            } else {
                ack({ ok: false, error: "Player slot no longer available" });
                return;
            }

            socketIdMap.delete(data.playerId); // Clean up old mapping
            socketIdMap.set(socket.id, code);
            socket.join(code);
            console.log(`[room] ${socket.id} rejoined room ${data.code}`);
            ack({ ok: true, playerId: socket.id });

            // Se o jogo já começou, re-enviar game-start para o jogador que reconectou
            if (room.gameState !== "lobby" && room.gameConfig) {
                socket.emit("game-start", {
                    mapId: room.gameConfig.mapId,
                    laps: room.gameConfig.laps,
                    players: room.players,
                    raceStartTime: room.gameConfig.raceStartTime,
                });
                return;
            }

            io.to(room.code).emit("lobby-update", {
                players: room.players,
                settings: room.settings,
            });
        });

        // --- PLAYER UPDATE ---
        socket.on("player-update", (data: { code: string; player: Partial<RoomPlayer> }) => {
            if (!guard(socket, "player-update", RATE.lobby)) return;
            const room = getRoomBySocket(socket.id);
            if (!room) return;
            const idx = room.players.findIndex(p => p.socketId === socket.id);
            if (idx === -1) return;

            const { name, color, modelUrl, modelPackId, isReady } = data.player;
            if (name !== undefined) room.players[idx].name = sanitizeName(name);
            const safeColor = sanitizeColor(color);
            if (safeColor) room.players[idx].color = safeColor;
            if (modelUrl !== undefined) room.players[idx].modelUrl = modelUrl;
            if (modelPackId !== undefined) room.players[idx].modelPackId = modelPackId;
            if (isReady !== undefined) room.players[idx].isReady = isReady;

            io.to(room.code).emit("lobby-update", {
                players: room.players,
                settings: room.settings,
            });
        });

        // --- SETTINGS UPDATE ---
        socket.on("settings-update", (data: { code: string; settings: { mapId: string; laps: number } }) => {
            if (!guard(socket, "settings-update", RATE.lobby)) return;
            const room = getRoomBySocket(socket.id);
            if (!room || room.hostSocketId !== socket.id) return;
            room.settings = {
                mapId: sanitizeMapId(data.settings?.mapId),
                laps: sanitizeLaps(data.settings?.laps),
            };
            io.to(room.code).emit("lobby-update", {
                players: room.players,
                settings: room.settings,
            });
        });

        // --- START GAME ---
        socket.on("start-game", (data: { code: string; mapId: string; laps: number; players: RoomPlayer[] }) => {
            if (!guard(socket, "start-game", RATE.lobby)) return;
            const room = getRoomBySocket(socket.id);
            if (!room || room.hostSocketId !== socket.id) return;
            // State machine: só permite start em "lobby" ou "finished" (rematch)
            // Em "countdown"/"racing", aplica cooldown para evitar double-click
            const now = Date.now();
            const isRematch = room.gameState !== "lobby";
            if (room.gameState === "countdown" || room.gameState === "racing") {
                const timeSinceInit = room.gameConfig
                    ? now - room.gameConfig.initiatedAt
                    : Infinity;
                if (timeSinceInit < REMATCH_COOLDOWN_MS) {
                    console.log(`[game] Room ${room.code}: start-game blocked (cooldown, ${Math.round(timeSinceInit)}ms elapsed)`);
                    return;
                }
            }

            // Transição de estado: lobby/finished → countdown
            room.gameState = "countdown";

            // Mesclar: jogadores humanos do SERVIDOR (source of truth) + bots do host
            const serverHumans = room.players.filter(p => !p.isBot);
            const hostBots = (data.players || []).filter((p: RoomPlayer) => p.isBot);
            room.players = [...serverHumans, ...hostBots];

            const raceStartTime = now + 4000;

            // Salvar config para re-envio em rejoin
            room.gameConfig = {
                mapId: data.mapId,
                laps: data.laps,
                raceStartTime,
                initiatedAt: now,
            };

            ensureRoomSimulation(room);

            console.log(`[game] Room ${room.code} ${isRematch ? "rematch" : "started"} (${serverHumans.length} humans, ${hostBots.length} bots), raceStart=${room.gameConfig.raceStartTime}`);
            io.to(room.code).emit("game-start", {
                mapId: room.gameConfig.mapId,
                laps: room.gameConfig.laps,
                players: room.players,
                raceStartTime: room.gameConfig.raceStartTime,
            });
        });

        // --- PLAYER INPUT ---
        socket.on("player-input", (data: { roomCode: string; input: PlayerInput }) => {
            if (!guard(socket, "player-input", RATE.input)) return;
            const { roomCode, input } = data;
            const sim = roomSims.get(roomCode);
            if (!sim) return;
            const simPlayer = sim.players.get(socket.id);
            if (!simPlayer) return;
            simPlayer.inputs.push(input);
        });

        // --- WebRTC Signaling ---
        socket.on("rtc-offer", (data: { targetId: string; offer: RTCSessionDescriptionInit }) => {
            if (!guard(socket, "rtc-offer", RATE.signaling)) return;
            io.to(data.targetId).emit("rtc-offer", { fromId: socket.id, offer: data.offer });
        });

        socket.on("rtc-answer", (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
            if (!guard(socket, "rtc-answer", RATE.signaling)) return;
            io.to(data.targetId).emit("rtc-answer", { fromId: socket.id, answer: data.answer });
        });

        socket.on("rtc-ice-candidate", (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
            if (!guard(socket, "rtc-ice-candidate", RATE.signaling)) return;
            io.to(data.targetId).emit("rtc-ice-candidate", { fromId: socket.id, candidate: data.candidate });
        });

        // --- POS Relay (Optimized: Binary + Spatial Culling) ---
        socket.on("pos-relay", (msg: any) => {
            if (!guard(socket, "pos-relay", RATE.posRelay)) return;
            const room = getRoomBySocket(socket.id);
            if (!room) return;

            // 1. If Binary (Buffer/ArrayBuffer)
            if (Buffer.isBuffer(msg) || ((msg as any).buffer instanceof ArrayBuffer)) {
                // Decode just position for culling
                const pos = decodePosHeader(msg);

                if (pos) {
                    const sender = room.players.find(p => p.socketId === socket.id);
                    if (sender) sender.lastPos = pos;

                    // Relay to peers
                    for (const p of room.players) {
                        if (p.socketId === socket.id) continue;

                        const targetPos = p.lastPos;
                        let inRange = true;

                        if (targetPos) {
                            const dx = pos.x - targetPos.x;
                            const dy = pos.y - targetPos.y;
                            const dz = pos.z - targetPos.z;
                            const distSq = dx * dx + dy * dy + dz * dz;
                            if (distSq > BROADCAST_RADIUS_SQ) inRange = false;
                        }

                        if (inRange) {
                            io.to(p.socketId).volatile.emit("pos-relay", msg);
                        }
                    }
                } else {
                    socket.to(room.code).volatile.emit("pos-relay", msg);
                }
            }
            // 2. Legacy JSON Fallback
            else if (typeof msg === 'object') {
                const p = msg.p;
                if (p && Array.isArray(p)) {
                    const sender = room.players.find(player => player.socketId === socket.id);
                    if (sender) sender.lastPos = { x: p[0], y: p[1], z: p[2] };
                }
                socket.to(room.code).volatile.emit("pos-relay", msg);
            }
        });

        // --- Reliable message relay ---
        socket.on("reliable-msg", (data: { code: string; msg: Record<string, unknown> }) => {
            if (!guard(socket, "reliable-msg", RATE.signaling)) return;
            const room = getRoomBySocket(socket.id);
            if (room && room.code === data.code) {
                socket.to(room.code).emit("reliable-msg", data.msg);
            }
        });

        // --- DISCONNECT ---
        socket.on("disconnect", () => {
            console.log(`[disconnect] ${socket.id}`);
            const room = getRoomBySocket(socket.id);
            if (!room) {
                socketIdMap.delete(socket.id);
                return;
            }

            // If mid-game, give grace period
            if (room.gameState !== "lobby") {
                console.log(`[room] ${socket.id} disconnected mid-game, grace period 15s`);
                io.to(room.code).emit("player-temporarily-disconnected", { playerId: socket.id });

                setTimeout(() => {
                    // Check if rejoined
                    const currentRoom = rooms.get(room.code);
                    if (!currentRoom) return; // Room gone

                    const stillDisconnected = currentRoom.players.some(p => p.socketId === socket.id);
                    if (stillDisconnected) {
                        removePlayerFromRoom(io, room, socket.id);
                    }
                }, 15000);
            } else {
                removePlayerFromRoom(io, room, socket.id);
            }
        });
    });
}
