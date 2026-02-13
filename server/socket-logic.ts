import { Server, Socket } from "socket.io";

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
}

interface Room {
    code: string;
    hostSocketId: string;
    players: RoomPlayer[];
    settings: { mapId: string; laps: number };
    gameStarted: boolean;
}

const rooms = new Map<string, Room>();

// ---- Helpers ----

function generateRoomCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (rooms.has(code)) return generateRoomCode();
    return code;
}

function getRoomBySocket(socketId: string): Room | undefined {
    for (const room of rooms.values()) {
        if (room.players.some(p => p.socketId === socketId)) return room;
    }
    return undefined;
}

// ---- Initialization Function ----

export function setupSocketIO(io: Server) {
    io.on("connection", (socket: Socket) => {
        console.log(`[connect] ${socket.id}`);

        // --- CLOCK SYNC (NTP-style ping/pong) ---
        socket.on("clock-sync-ping", (clientSendTime: number, ack: Function) => {
            const serverNow = Date.now();
            ack({ clientSendTime, serverTime: serverNow });
        });

        // --- CREATE ROOM ---
        socket.on("create-room", (data: { player: Omit<RoomPlayer, "socketId"> }, ack: Function) => {
            const code = generateRoomCode();
            const player: RoomPlayer = { ...data.player, socketId: socket.id, isHost: true };
            const room: Room = {
                code,
                hostSocketId: socket.id,
                players: [player],
                settings: { mapId: "green-valley", laps: 3 },
                gameStarted: false,
            };
            rooms.set(code, room);
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
            const room = rooms.get(data.code.toUpperCase());
            if (!room) {
                ack({ ok: false, error: "Room not found" });
                return;
            }
            if (room.gameStarted) {
                ack({ ok: false, error: "Game already started" });
                return;
            }
            if (room.players.length >= 8) {
                ack({ ok: false, error: "Room is full" });
                return;
            }
            const player: RoomPlayer = { ...data.player, socketId: socket.id, isHost: false };
            room.players.push(player);
            socket.join(data.code.toUpperCase());
            console.log(`[room] ${socket.id} joined room ${data.code}`);
            ack({
                ok: true,
                playerId: socket.id,
                players: room.players,
                settings: room.settings,
            });
            // Broadcast updated lobby to all in room
            io.to(room.code).emit("lobby-update", {
                players: room.players,
                settings: room.settings,
            });
        });

        // --- PLAYER UPDATE (name, color, car) ---
        socket.on("player-update", (data: { code: string; player: Partial<RoomPlayer> }) => {
            const room = rooms.get(data.code);
            if (!room) return;
            const idx = room.players.findIndex(p => p.socketId === socket.id);
            if (idx === -1) return;
            // Only allow updating safe fields
            const { name, color, modelUrl, modelPackId, isReady } = data.player;
            if (name !== undefined) room.players[idx].name = name;
            if (color !== undefined) room.players[idx].color = color;
            if (modelUrl !== undefined) room.players[idx].modelUrl = modelUrl;
            if (modelPackId !== undefined) room.players[idx].modelPackId = modelPackId;
            if (isReady !== undefined) room.players[idx].isReady = isReady;
            io.to(room.code).emit("lobby-update", {
                players: room.players,
                settings: room.settings,
            });
        });

        // --- SETTINGS UPDATE (host only) ---
        socket.on("settings-update", (data: { code: string; settings: { mapId: string; laps: number } }) => {
            const room = rooms.get(data.code);
            if (!room || room.hostSocketId !== socket.id) return;
            room.settings = data.settings;
            io.to(room.code).emit("lobby-update", {
                players: room.players,
                settings: room.settings,
            });
        });

        // --- START GAME (host only) ---
        // Server-authoritative: server decides the absolute race start time.
        // All clients sync their countdown to this timestamp using their clock offset.
        socket.on("start-game", (data: { code: string; mapId: string; laps: number; players: RoomPlayer[] }) => {
            const room = rooms.get(data.code);
            if (!room || room.hostSocketId !== socket.id) return;
            room.gameStarted = true;
            room.players = data.players;

            // Race starts 4 seconds from now: 3s countdown + 0.5s "GO!" display + 0.5s buffer
            const raceStartTime = Date.now() + 4000;

            console.log(`[game] Room ${data.code} started with ${data.players.length} players, raceStart=${raceStartTime}`);
            io.to(room.code).emit("game-start", {
                mapId: data.mapId,
                laps: data.laps,
                players: data.players,
                raceStartTime,
            });
        });

        // --- WebRTC Signaling ---
        socket.on("rtc-offer", (data: { targetId: string; offer: RTCSessionDescriptionInit }) => {
            io.to(data.targetId).emit("rtc-offer", { fromId: socket.id, offer: data.offer });
        });

        socket.on("rtc-answer", (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
            io.to(data.targetId).emit("rtc-answer", { fromId: socket.id, answer: data.answer });
        });

        socket.on("rtc-ice-candidate", (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
            io.to(data.targetId).emit("rtc-ice-candidate", { fromId: socket.id, candidate: data.candidate });
        });

        // --- POS Relay (fallback when WebRTC unavailable) ---
        socket.on("pos-relay", (data: { code: string; msg: { type: "POS"; id: string; p: [number, number, number]; r: number; s: number; l: number; t: number } }) => {
            socket.to(data.code).volatile.emit("pos-relay", data.msg);
        });

        // --- Reliable message relay ---
        socket.on("reliable-msg", (data: { code: string; msg: Record<string, unknown> }) => {
            socket.to(data.code).emit("reliable-msg", data.msg);
        });

        // --- DISCONNECT ---
        socket.on("disconnect", () => {
            const room = getRoomBySocket(socket.id);
            if (!room) return;

            room.players = room.players.filter(p => p.socketId !== socket.id);

            if (room.players.length === 0) {
                rooms.delete(room.code);
                console.log(`[room] Room ${room.code} deleted (empty)`);
                return;
            }

            // If host left, promote next human player
            if (room.hostSocketId === socket.id) {
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
            io.to(room.code).emit("player-disconnected", { playerId: socket.id });
        });
    });
}
