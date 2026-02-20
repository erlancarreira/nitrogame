"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { networkManager, type NetworkMessage } from "@/lib/game/networking";
import type { KartRef } from "@/components/game/KartPro";
import type { BananaPoolRef } from "@/components/game/InstancedBananas";
import type { OilPoolRef } from "@/components/game/InstancedOil";
import type { SoundEffectsRef } from "@/components/game/SoundEffects";
import type { Controls } from "@/lib/game/types";
import type { RacerState } from "./use-race-state";

// ── Types ───────────────────────────────────────────────────────────

export type ItemType = "none" | "mushroom" | "banana" | "red_shell" | "star" | "oil";

export interface RedShell {
  id: string;
  ownerId: string;
  targetId: string | null;
  startPosition: [number, number, number];
  startRotation: number;
}

interface UseItemSystemOptions {
  kartRef: React.RefObject<KartRef | null>;
  botRefs: React.MutableRefObject<Record<string, KartRef>>;
  humanPlayerId: string | undefined;
  racerStatesRef?: React.MutableRefObject<Map<string, RacerState>>;
  playersCount: number;
  onItemChange?: (item: ItemType) => void;
  getAllKartRefs: () => Array<{ id: string; ref: React.RefObject<KartRef> }>;
}

const DROP_BACK_DIST = 4;      // tenta 4 ou 5
const DROP_OIL_DIST = 4;
const DROP_HEIGHT = 0.4;
const OIL_HEIGHT = 0.05;
const ITEM_HIT_DEDUP_MS = 600; // janela para deduplicar hits do sensor Rapier + proximidade
let _shellIdCounter = 0;

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Manages the entire item system:
 * - Item collection (rank-based distribution)
 * - Item usage (human + bots)
 * - Collision handlers (banana, oil, shell)
 * - Network item-hit sync
 * - Red shell state
 * - Pool refs (banana, oil)
 */
export function useItemSystem({
  kartRef,
  botRefs,
  humanPlayerId,
  racerStatesRef,
  playersCount,
  onItemChange,
  getAllKartRefs,
}: UseItemSystemOptions) {
  // Helper: check if an entity is locally owned (human player or host's bot)
  const isLocalEntity = useCallback((id: string) => {
    if (id === humanPlayerId) return true;
    return !!botRefs.current[id];
  }, [humanPlayerId, botRefs]);
  const [currentItem, setCurrentItem] = useState<ItemType>("none");
  const [redShells, setRedShells] = useState<RedShell[]>([]);

  const wasItemPressed = useRef(false);
  const bananaPoolRef = useRef<BananaPoolRef>(null);
  const oilPoolRef = useRef<OilPoolRef>(null);
  const sfxRef = useRef<SoundEffectsRef>(null);
  const botTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Deduplicação: evita duplo spinOut quando sensor Rapier E proximidade disparam juntos
  const recentItemHitsRef = useRef<Map<string, number>>(new Map());

  // Stable refs for useCallback closures
  const humanPlayerIdRef = useRef(humanPlayerId);
  humanPlayerIdRef.current = humanPlayerId;
  const currentItemRef = useRef(currentItem);
  currentItemRef.current = currentItem;
  const onItemChangeRef = useRef(onItemChange);
  onItemChangeRef.current = onItemChange;
  const playersCountRef = useRef(playersCount);
  playersCountRef.current = playersCount;

  // Cleanup bot timers on unmount
  useEffect(() => {
    return () => {
      botTimers.current.forEach((t) => clearTimeout(t));
      botTimers.current = [];
    };
  }, []);

  // ── Shell spawn/despawn with network broadcast ──

  const spawnShell = useCallback((shell: RedShell) => {
    setRedShells((prev) => [...prev, shell]);
    if (networkManager.roomCode) {
      networkManager.broadcast({ type: "SHELL_SPAWN", shell });
    }
  }, []);

  const despawnShell = useCallback((shellId: string) => {
    setRedShells((prev) => prev.filter((s) => s.id !== shellId));
    if (networkManager.roomCode) {
      networkManager.broadcast({ type: "SHELL_DESPAWN", shellId });
    }
  }, []);

  // ── Targeting ──

  const getTargetFor = useCallback(
    (sourceId: string) => {
      const all = getAllKartRefs();
      const opponents = all.filter((k) => k.id !== sourceId);
      if (opponents.length > 0) {
        return opponents[Math.floor(Math.random() * opponents.length)].id;
      }
      return null;
    },
    [getAllKartRefs]
  );

  // ── Bot Item Usage ──

  const useBotItem = useCallback(
    (botId: string, item: Exclude<ItemType, "none">) => {
      const bot = botRefs.current[botId];
      if (!bot) return;

      if (item === "mushroom") {
        bot.applyBoost(2.0, 2.0);
      } else if (item === "star") {
        bot.applyStarPower?.(8);
      } else if (item === "banana") {
        const pos = bot.getPosition();
        const rot = bot.getRotation();
        const spawnPos: [number, number, number] = [pos[0] - Math.sin(rot) * DROP_BACK_DIST, DROP_HEIGHT, pos[2] - Math.cos(rot) * DROP_BACK_DIST];
        const bananaNetId = `bn_${botId}_${Date.now()}`;
        bananaPoolRef.current?.spawn(spawnPos, 0, botId, bananaNetId);
        if (networkManager.roomCode) {
          networkManager.broadcast({ type: "BANANA_SPAWN", bananaNetId, position: spawnPos, rotationY: 0, ownerId: botId });
        }
      } else if (item === "oil") {
        const pos = bot.getPosition();
        const rot = bot.getRotation();
        const spawnPos: [number, number, number] = [pos[0] - Math.sin(rot) * DROP_OIL_DIST, OIL_HEIGHT, pos[2] - Math.cos(rot) * DROP_OIL_DIST];
        oilPoolRef.current?.spawn(spawnPos, botId);
        if (networkManager.roomCode) {
          networkManager.broadcast({ type: "OIL_SPAWN", position: spawnPos, ownerId: botId });
        }
      } else if (item === "red_shell") {
        const pos = bot.getPosition();
        const rot = bot.getRotation();
        const target = getTargetFor(botId);
        spawnShell({
          id: `shell_${botId}_${Date.now()}_${++_shellIdCounter}`,
          ownerId: botId,
          targetId: target,
          startPosition: [
            pos[0] + Math.sin(rot) * 2,
            0.5,
            pos[2] + Math.cos(rot) * 2,
          ],
          startRotation: rot,
        });
      }
    },
    [botRefs, getTargetFor, spawnShell]
  );

  // ── Item Collection (rank-based distribution) ──

  const handleItemCollect = useCallback(
    (collectorId: string) => {
      const racerState = racerStatesRef?.current?.get(collectorId);
      const positionRank = racerState?.position ?? 1;
      const totalRacers = racerStatesRef?.current?.size ?? playersCountRef.current;

      const rnd = Math.random();
      let newItem: Exclude<ItemType, "none"> = "mushroom";

      const isLeader = positionRank === 1;
      const isLast = positionRank === totalRacers && totalRacers > 1;

      if (isLeader) {
        if (rnd < 0.4) newItem = "banana";
        else if (rnd < 0.7) newItem = "oil";
        else if (rnd < 0.9) newItem = "mushroom";
        else newItem = "red_shell";
      } else if (isLast) {
        if (rnd < 0.4) newItem = "star";
        else if (rnd < 0.7) newItem = "mushroom";
        else newItem = "red_shell";
      } else {
        if (rnd < 0.3) newItem = "mushroom";
        else if (rnd < 0.5) newItem = "red_shell";
        else if (rnd < 0.7) newItem = "banana";
        else if (rnd < 0.9) newItem = "oil";
        else newItem = "star";
      }

      if (collectorId === humanPlayerIdRef.current) {
        if (currentItemRef.current === "none") {
          setCurrentItem(newItem);
          onItemChangeRef.current?.(newItem);
          sfxRef.current?.play("item_collect");
        }
      } else {
        // [Fix 2.7] Reduced delay from 500+2500ms to 300+700ms — bots now use items faster
        // Previous: up to 3s delay, bot could change waypoints twice before using item
        const delay = 300 + Math.random() * 700;
        const timer = setTimeout(() => useBotItem(collectorId, newItem), delay);
        botTimers.current.push(timer);
      }
    },
    [racerStatesRef, useBotItem]
  );


  // ── Collision Handlers (Authority: VICTIM reports hit) ──

  // netId: ID cross-cliente estável (gerado pelo dropper) — usado para despawn correto no lado remoto
  const handleBananaCollide = useCallback((bananaId: string, kartId: string, netId: string = bananaId) => {
    // Deduplicação: evita duplo spinOut quando sensor Rapier E ItemCollisionChecker disparam juntos
    const dedupKey = `${netId}_${kartId}`;
    const now = performance.now();
    const lastHit = recentItemHitsRef.current.get(dedupKey);
    if (lastHit && now - lastHit < ITEM_HIT_DEDUP_MS) return;
    recentItemHitsRef.current.set(dedupKey, now);

    // 1. Despawn visual local imediato (predição)
    bananaPoolRef.current?.despawn(bananaId);

    // 2. Authority Check: só a VÍTIMA transmite o hit
    if (kartId === humanPlayerIdRef.current) {
      kartRef.current?.spinOut();
      sfxRef.current?.play("banana_hit");
      sfxRef.current?.play("spin_out");

      // itemId = netId para que o dropper possa despawnar corretamente pelo netId
      networkManager.broadcast({
        type: "ITEM_HIT",
        targetId: kartId,
        effect: "spinOut",
        itemId: netId,
        itemType: "banana"
      });
    }
    // Se Bot acertou + Sou Host -> Autoridade do Bot
    else if (networkManager.isHost && botRefs.current[kartId]) {
      botRefs.current[kartId].spinOut();
      networkManager.broadcast({
        type: "ITEM_HIT",
        targetId: kartId,
        effect: "spinOut",
        itemId: netId,
        itemType: "banana"
      });
    }
    // Else: jogador remoto acertou — aguarda ITEM_HIT dele para confirmar
  }, [kartRef, botRefs]);

  const handleOilCollide = useCallback((oilId: string, kartId: string) => {
    // Deduplicação para óleo (cooldown 2s)
    const dedupKey = `oil_${oilId}_${kartId}`;
    const now = performance.now();
    const lastHit = recentItemHitsRef.current.get(dedupKey);
    if (lastHit && now - lastHit < 2100) return;
    recentItemHitsRef.current.set(dedupKey, now);

    if (kartId === humanPlayerIdRef.current) {
      kartRef.current?.applyOilSlip?.(2.5);
      networkManager.broadcast({ type: "ITEM_HIT", targetId: kartId, effect: "oilSlip" });
    } else if (networkManager.isHost && botRefs.current[kartId]) {
      botRefs.current[kartId].applyOilSlip?.(2.5);
      networkManager.broadcast({ type: "ITEM_HIT", targetId: kartId, effect: "oilSlip" });
    }
  }, [kartRef, botRefs]);

  const handleShellCollide = useCallback((targetId: string, shellId: string) => {
    // [Fix 2.8] Deduplication: prevent double-hit from sensor + proximity checker
    const dedupKey = `shell_${shellId}_${targetId}`;
    const now = performance.now();
    const lastHit = recentItemHitsRef.current.get(dedupKey);
    if (lastHit && now - lastHit < ITEM_HIT_DEDUP_MS) return;
    recentItemHitsRef.current.set(dedupKey, now);

    despawnShell(shellId);

    if (targetId === humanPlayerIdRef.current) {
      // [Fix 2.8] Check invincibility before applying effect and broadcasting
      const isInvincible = kartRef.current?.getIsInvincible?.() ?? false;
      if (isInvincible) return; // Star power blocks shell
      kartRef.current?.spinOut();
      sfxRef.current?.play("spin_out");
      networkManager.broadcast({
        type: "ITEM_HIT",
        targetId,
        effect: "spinOut",
        itemId: shellId,
        itemType: "shell"
      });
    } else if (networkManager.isHost && botRefs.current[targetId]) {
      // [Fix 2.8] Check bot invincibility (star power timer)
      const isInvincible = botRefs.current[targetId].getIsInvincible?.() ?? false;
      if (isInvincible) return;
      botRefs.current[targetId].spinOut();
      networkManager.broadcast({
        type: "ITEM_HIT",
        targetId,
        effect: "spinOut",
        itemId: shellId,
        itemType: "shell"
      });
    }
  }, [kartRef, botRefs, despawnShell]);

  // ── Network: incoming ITEM_HIT + SHELL_SPAWN/DESPAWN ──

  const handleNetworkItemHit = useCallback(
    (msg: NetworkMessage) => {
      if (msg.type === "ITEM_HIT") {
        // 1. Apply Effect
        if (msg.targetId === humanPlayerIdRef.current) {
          // Double check: Did I already process this? (Local prediction)
          // Simple idempotent check: If I'm already spinning, maybe ignore?
          // For now, trust the message (maybe I missed the local trigger).
          if (msg.effect === "spinOut") {
            kartRef.current?.spinOut();
            sfxRef.current?.play("banana_hit"); // Sound
          } else if (msg.effect === "oilSlip") {
            kartRef.current?.applyOilSlip?.(2.5);
          }
        }

        // 2. Process Item Despawn — usa despawnByNetId para garantir despawn correto
        // independente de qual slot o cliente local usou para a banana
        if (msg.itemId && msg.itemType === "banana") {
          bananaPoolRef.current?.despawnByNetId(msg.itemId);
        } else if (msg.itemId && msg.itemType === "shell") {
          despawnShell(msg.itemId);
        }
      }
      // ── Item spawn sync (remote banana/oil appear on our client) ──
      else if (msg.type === "BANANA_SPAWN") {
        // Skip if locally owned (human or host's bot — already spawned)
        if (!isLocalEntity(msg.ownerId)) {
          // Passa bananaNetId para que este cliente possa despawnar pelo mesmo ID cross-cliente
          bananaPoolRef.current?.spawn(msg.position, msg.rotationY, msg.ownerId, msg.bananaNetId);
        }
      } else if (msg.type === "OIL_SPAWN") {
        if (!isLocalEntity(msg.ownerId)) {
          oilPoolRef.current?.spawn(msg.position, msg.ownerId);
        }
      }
      else if (msg.type === "SHELL_SPAWN") {
        setRedShells((prev) => {
          if (prev.some((s) => s.id === msg.shell.id)) return prev;
          return [...prev, msg.shell];
        });
      } else if (msg.type === "SHELL_DESPAWN") {
        setRedShells((prev) => prev.filter((s) => s.id !== msg.shellId));
      }
    },
    [kartRef, despawnShell, isLocalEntity]
  );

  // ── State Replication (Sync) ──
  const getWorldSnapshot = useCallback(() => {
    return {
      shells: redShells,
      bananas: bananaPoolRef.current?.getSnapshot() || [],
      oils: oilPoolRef.current?.getSnapshot() || []
    };
  }, [redShells]);

  const restoreWorldSnapshot = useCallback((data: { shells: any[], bananas: any[], oils: any[] }) => {
    // 1. Shells
    setRedShells(data.shells || []);
    // 2. Bananas
    if (data.bananas) bananaPoolRef.current?.restoreSnapshot(data.bananas);
    // 3. Oils
    if (data.oils) oilPoolRef.current?.restoreSnapshot(data.oils);
  }, []);



  // ── Human Item Usage Effect ──

  const useHumanItem = useCallback(
    (controls: Controls) => {
      if (controls.item && !wasItemPressed.current) {
        const item = currentItemRef.current;
        if (item === "mushroom") {
          kartRef.current?.applyBoost(2.0, 2.0);
          sfxRef.current?.play("boost");
        } else if (item === "banana") {
          if (kartRef.current) {
            const pos = kartRef.current.getPosition();
            const rot = kartRef.current.getRotation();
            const spawnPos: [number, number, number] = [pos[0] - Math.sin(rot) * 2, 0.5, pos[2] - Math.cos(rot) * 2];
            const bananaNetId = `bn_${humanPlayerIdRef.current}_${Date.now()}`;
            bananaPoolRef.current?.spawn(spawnPos, 0, humanPlayerIdRef.current || "p1", bananaNetId);
            if (networkManager.roomCode) {
              networkManager.broadcast({ type: "BANANA_SPAWN", bananaNetId, position: spawnPos, rotationY: 0, ownerId: humanPlayerIdRef.current || "p1" });
            }
          }
        } else if (item === "red_shell") {
          if (kartRef.current) {
            const pos = kartRef.current.getPosition();
            const rot = kartRef.current.getRotation();
            const target = getTargetFor(humanPlayerIdRef.current || "p1");
            spawnShell({
              id: `shell_${humanPlayerIdRef.current || "p1"}_${Date.now()}_${++_shellIdCounter}`,
              ownerId: humanPlayerIdRef.current || "p1",
              targetId: target,
              startPosition: [pos[0] + Math.sin(rot) * 2, 0.5, pos[2] + Math.cos(rot) * 2],
              startRotation: rot,
            });
          }
        } else if (item === "star") {
          kartRef.current?.applyStarPower?.(8);
          sfxRef.current?.play("boost");
        } else if (item === "oil") {
          if (kartRef.current) {
            const pos = kartRef.current.getPosition();
            const rot = kartRef.current.getRotation();
            const spawnPos: [number, number, number] = [pos[0] - Math.sin(rot) * 3, 0.05, pos[2] - Math.cos(rot) * 3];
            oilPoolRef.current?.spawn(spawnPos, humanPlayerIdRef.current || "p1");
            if (networkManager.roomCode) {
              networkManager.broadcast({ type: "OIL_SPAWN", position: spawnPos, ownerId: humanPlayerIdRef.current || "p1" });
            }
          }
        }

        if (item !== "none") {
          setCurrentItem("none");
          onItemChangeRef.current?.("none");
        }

        wasItemPressed.current = true;
      } else if (!controls.item) {
        wasItemPressed.current = false;
      }
    },
    [kartRef, getTargetFor, spawnShell]
  );

  return {
    // State
    currentItem,
    redShells,
    // Refs (for JSX binding)
    bananaPoolRef,
    oilPoolRef,
    sfxRef,
    // Handlers
    handleItemCollect,
    handleBananaCollide,
    handleOilCollide,
    handleShellCollide,
    handleNetworkItemHit,
    useHumanItem,
    // Sync
    getWorldSnapshot,
    restoreWorldSnapshot
  };
}
