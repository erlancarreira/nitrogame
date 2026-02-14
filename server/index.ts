import { createServer } from "http";
import { Server, Socket } from "socket.io";
import type { PlayerInput, GameSnapshot, PlayerState } from "../types/network";
import {
  KartPhysicsState,
  createPhysicsState,
  updateKartPhysics,
  stateToPlayerState,
  normalizeInput,
} from "../lib/game/kart-physics-core";

const PORT = Number(process.env.PORT) || 3001;
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

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

// Simulation types for authoritative server
interface SimPlayer {
  physics: KartPhysicsState;
  inputs: PlayerInput[];
  lastProcessedFrame: number;
}

interface RoomSimulation {
  roomCode: string;
  frame: number;
  lastSnapshotAt: number;
  players: Map<string, SimPlayer>; // key = socketId
}

const rooms = new Map<string, Room>();
const roomSims = new Map<string, RoomSimulation>();

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

// ---- Input Validation ----

const MAX_NAME_LENGTH = 20;
const COLOR_REGEX = /^#[0-9a-fA-F]{3,8}$/;
const VALID_MAP_IDS = ["green-valley", "sunset-circuit", "frost-peak", "neon-nights"];
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

// ---- Helpers ----

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  // Fallback: use timestamp-based code (practically unreachable)
  return Date.now().toString(36).toUpperCase().slice(-6);
}

function getRoomBySocket(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return undefined;
}

function removePlayerFromRoom(room: Room, socketId: string): void {
  room.players = room.players.filter(p => p.socketId !== socketId);

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
  for (const player of room.players) {
    // TODO: Use actual spawn positions from track config.
    const physics = createPhysicsState([0, 0, 0]);
    sim.players.set(player.socketId, {
      physics,
      inputs: [],
      lastProcessedFrame: 0,
    });
  }

  console.log(`[sim] Initialized simulation for room ${room.code} with ${room.players.length} players`);
  return sim;
}

// ---- Socket.IO Handlers ----

io.on("connection", (socket: Socket) => {
  console.log(`[connect] ${socket.id}`);

  // --- CLOCK SYNC (NTP-style ping/pong) ---
  // Client sends its local timestamp, server responds with server time.
  // Client uses RTT + server time to calculate clock offset.
  // This runs during lobby phase so offset is ready before race starts.
  socket.on("clock-sync-ping", (clientSendTime: number, ack: Function) => {
    if (!guard(socket, "clock-sync", RATE.clock)) {
      ack?.({ clientSendTime, serverTime: Date.now(), rateLimited: true });
      return;
    }
    const serverNow = Date.now();
    ack({ clientSendTime, serverTime: serverNow });
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
    };
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
    if (!guard(socket, "join-room", RATE.lobby)) return ack({ ok: false, error: "rate-limited" });
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
    const player: RoomPlayer = {
      ...data.player,
      name: sanitizeName(data.player?.name),
      color: sanitizeColor(data.player?.color) || "#4488ff",
      socketId: socket.id,
      isHost: false,
    };
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

  // --- REJOIN ROOM (after temporary disconnect) ---
  socket.on("rejoin-room", (data: { code: string; playerId: string }, ack: Function) => {
    if (!guard(socket, "rejoin-room", RATE.lobby)) return ack({ ok: false, error: "rate-limited" });
    const room = rooms.get(data.code);
    if (!room) {
      ack({ ok: false, error: "Room no longer exists" });
      return;
    }

    // Find the player's old entry (might still exist if disconnect was brief)
    const existingIdx = room.players.findIndex(p => p.socketId === data.playerId);
    if (existingIdx !== -1) {
      // Update socket ID to the new one (Socket.IO assigns new ID on reconnect)
      room.players[existingIdx].socketId = socket.id;
      if (room.hostSocketId === data.playerId) {
        room.hostSocketId = socket.id;
      }
    } else {
      // Player was already removed — can't rejoin mid-race
      ack({ ok: false, error: "Player slot no longer available" });
      return;
    }

    socket.join(data.code);
    console.log(`[room] ${socket.id} rejoined room ${data.code} (was ${data.playerId})`);
    ack({ ok: true, playerId: socket.id });

    io.to(room.code).emit("lobby-update", {
      players: room.players,
      settings: room.settings,
    });
  });

  // --- PLAYER UPDATE (name, color, car) ---
  socket.on("player-update", (data: { code: string; player: Partial<RoomPlayer> }) => {
    if (!guard(socket, "player-update", RATE.lobby)) return;
    const room = rooms.get(data.code);
    if (!room) return;
    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx === -1) return;
    // Only allow updating safe fields (with sanitization)
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

  // --- SETTINGS UPDATE (host only) ---
  socket.on("settings-update", (data: { code: string; settings: { mapId: string; laps: number } }) => {
    if (!guard(socket, "settings-update", RATE.lobby)) return;
    const room = rooms.get(data.code);
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

  // --- START GAME (host only) ---
  // Server-authoritative: server decides the absolute race start time.
  // All clients sync their countdown to this timestamp using their clock offset.
  socket.on("start-game", (data: { code: string; mapId: string; laps: number; players: RoomPlayer[] }) => {
    if (!guard(socket, "start-game", RATE.lobby)) return;
    const room = rooms.get(data.code);
    if (!room || room.hostSocketId !== socket.id) return;
    room.gameStarted = true;
    room.players = data.players;

    // Initialize authoritative simulation for this room
    ensureRoomSimulation(room);

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

  // --- PLAYER INPUT (authoritative sim) ---
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

  // --- POS Relay (fallback when WebRTC unavailable) ---
  socket.on("pos-relay", (data: { code: string; msg: { type: "POS"; id: string; p: [number, number, number]; r: number; s: number; l: number; t: number } }) => {
    if (!guard(socket, "pos-relay", RATE.posRelay)) return;
    socket.to(data.code).volatile.emit("pos-relay", data.msg);
  });

  // --- Reliable message relay ---
  socket.on("reliable-msg", (data: { code: string; msg: Record<string, unknown> }) => {
    if (!guard(socket, "reliable-msg", RATE.signaling)) return;
    socket.to(data.code).emit("reliable-msg", data.msg);
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    const disconnectedId = socket.id;

    // During an active game, give a grace period for reconnection (15s)
    if (room.gameStarted) {
      console.log(`[room] ${disconnectedId} disconnected mid-game, grace period 15s`);
      io.to(room.code).emit("player-temporarily-disconnected", { playerId: disconnectedId });

      setTimeout(() => {
        // Check if player rejoined (socketId would have changed via rejoin-room)
        const stillDisconnected = room.players.some(p => p.socketId === disconnectedId);
        if (!stillDisconnected) return; // Already rejoined with new ID

        // Grace period expired — remove player
        removePlayerFromRoom(room, disconnectedId);
      }, 15000);
      return;
    }

    // In lobby — remove immediately
    removePlayerFromRoom(room, disconnectedId);
  });
});

// ---- Authoritative Simulation Loop ----

setInterval(() => {
  const now = Date.now();

  for (const sim of roomSims.values()) {
    sim.frame += 1;

    // Update each player's physics based on queued inputs
    for (const [socketId, simPlayer] of sim.players) {
      const { physics } = simPlayer;
      const inputs = simPlayer.inputs;

      // Process queued inputs in frame order
      if (inputs.length > 0) {
        inputs.sort((a, b) => a.frame - b.frame);
        for (const input of inputs) {
          if (input.frame <= simPlayer.lastProcessedFrame) continue;
          const physInput = normalizeInput({
            throttle: input.throttle,
            steer: input.steer,
            brake: input.brake,
            useItem: input.useItem,
          });
          updateKartPhysics(physics, physInput, SIM_DT_MS / 1000);
          simPlayer.lastProcessedFrame = input.frame;
        }
        // Clear processed inputs
        simPlayer.inputs = [];
      } else {
        // No new input — still advance physics with neutral input for drag/decay
        const neutralInput = normalizeInput({
          throttle: 0,
          steer: 0,
          brake: false,
          useItem: false,
        });
        updateKartPhysics(physics, neutralInput, SIM_DT_MS / 1000);
      }
    }

    // Periodically send snapshots to clients
    if (now - sim.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      const playersState: Record<string, PlayerState> = {};
      for (const [socketId, simPlayer] of sim.players) {
        playersState[socketId] = stateToPlayerState(
          socketId,
          simPlayer.physics,
          sim.frame,
          now
        );
      }

      const snapshot: GameSnapshot = {
        frame: sim.frame,
        serverTime: now,
        players: playersState,
      };

      // Send per-player with their own lastProcessedFrame for reconciliation
      for (const [socketId, simPlayer] of sim.players) {
        io.to(socketId).emit("game-snapshot", {
          snapshot,
          lastProcessedFrame: simPlayer.lastProcessedFrame,
        });
      }

      sim.lastSnapshotAt = now;
    }
  }
}, SIM_DT_MS);

// ---- Start Server ----

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Nitro Rush game server listening on port ${PORT}`);
});
