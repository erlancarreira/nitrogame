"use client";

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MAPS, type MapConfig } from "@/lib/game/maps";
import { Copy, Check, MessageCircle } from "lucide-react";

// All maps are now available
const AVAILABLE_MAPS = MAPS;
import { KART_COLORS, type Player } from "@/lib/game/types";
import { networkManager } from "@/lib/game/networking";
import type { TEXTS } from "@/lib/game/i18n";

interface LobbyViewProps {
  t: (typeof TEXTS)["en"];
  gameMode: "local" | "online";
  isHost: boolean;
  onlineRole: "host" | "client" | null;
  lobbyCode: string;
  players: Player[];
  playerName: string;
  selectedMap: MapConfig;
  laps: number;
  onPlayerNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onColorChange: () => void;
  onModelChange: () => void;
  onPackChange: () => void;
  onMapChange: (map: MapConfig) => void;
  onLapsChange: (laps: number) => void;
  onStartGame: () => void;
  onBack: () => void;
}

function getMapIdColor(id: string) {
  switch (id) {
    case "green-valley": return "from-green-400 to-emerald-600";
    case "sunset-circuit": return "from-orange-400 to-red-600";
    case "frost-peak": return "from-cyan-400 to-blue-600";
    case "neon-nights": return "from-purple-500 to-indigo-700";
    case "volcano-rush": return "from-red-500 to-orange-600";
    case "crystal-caves": return "from-blue-400 to-purple-500";
    case "cyber-loop": return "from-green-400 to-cyan-500";
    case "cartoon-race-track-oval": return "from-green-500 to-emerald-700";
    default: return "from-slate-400 to-slate-600";
  }
}

function getDifficultyColor(difficulty: string) {
  switch (difficulty) {
    case "easy": return "bg-green-500/90 border-green-300";
    case "medium": return "bg-yellow-500/90 border-yellow-300";
    case "hard": return "bg-orange-500/90 border-orange-300";
    case "expert": return "bg-red-500/90 border-red-300";
    default: return "bg-slate-500/90 border-slate-300";
  }
}

export function LobbyView({
  t, gameMode, isHost, onlineRole, lobbyCode,
  players, playerName, selectedMap, laps,
  onPlayerNameChange, onColorChange, onModelChange, onPackChange,
  onMapChange, onLapsChange, onStartGame, onBack,
}: LobbyViewProps) {
  const myPlayer = players[0];
  const [codeCopied, setCodeCopied] = useState(false);

  const code = lobbyCode || networkManager.myId || "";

  const handleCopyCode = useCallback(() => {
    if (!code || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(err => console.error("Copy failed", err));
  }, [code]);

  const handleShareWhatsapp = useCallback(() => {
    if (!code) return;
    const url = typeof window !== "undefined" ? window.location.origin : "";
    const message = `🏁 Nitro Rush!\nEntra na sala: ${code}\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  }, [code]);

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col md:flex-row gap-2 md:gap-4 animate-in slide-in-from-bottom-5 duration-300 min-h-0 max-h-[calc(100vh-180px)] sm:max-h-[calc(100vh-220px)]">

      {/* ── Left Panel: Driver License ── */}
      {/* Mobile: compact horizontal bar. Desktop: full vertical card */}
      <div className="w-full md:w-1/3 lg:w-70 bg-white rounded-xl md:rounded-2xl shadow-xl overflow-hidden border-3 border-slate-100 flex flex-col shrink-0">

        {/* Header — hidden on small mobile, shown from sm+ */}
        <div className="hidden sm:block bg-sky-500 px-3 py-2 sm:px-4 sm:py-2.5 border-b-3 border-sky-600">
          <h2 className="text-base sm:text-lg font-black text-white italic uppercase tracking-wider text-center flex items-center justify-center gap-2">
            <span className="text-xl sm:text-2xl">🪪</span> {t.driverProfile}
          </h2>
        </div>

        {/* Online lobby code + share actions */}
        {gameMode === "online" && (
          <div className="bg-slate-800 px-2 sm:px-3 py-2 sm:py-3">
            <p className="text-slate-400 text-[10px] sm:text-xs font-bold uppercase text-center mb-1">{t.lobbyCode}</p>
            <div className="flex items-center justify-center gap-1.5 sm:gap-2">
              {/* Code display */}
              <span className="text-yellow-400 font-black text-lg sm:text-2xl tracking-[0.2em] select-text">
                {code || t.connecting}
              </span>
            </div>
            {/* Action buttons */}
            {code && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <button
                  onClick={handleCopyCode}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all active:scale-95 cursor-pointer ${
                    codeCopied
                      ? "bg-green-500/20 text-green-400 border border-green-500/40"
                      : "bg-white/10 text-white/80 border border-white/20 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  {codeCopied ? <Check size={14} /> : <Copy size={14} />}
                  {codeCopied ? t.copied : t.copyCode}
                </button>
                <button
                  onClick={handleShareWhatsapp}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/40 hover:bg-[#25D366]/30 transition-all active:scale-95 cursor-pointer"
                >
                  <MessageCircle size={14} />
                  <span className="hidden sm:inline">{t.shareWhatsapp}</span>
                  <span className="sm:hidden">WhatsApp</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Driver info — compact row on mobile, vertical on desktop */}
        <div className="p-2 sm:p-3 md:p-4 flex-1 flex flex-row sm:flex-col items-center gap-2 sm:gap-3 md:gap-4 bg-slate-50 overflow-y-auto">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div className="w-12 h-12 sm:w-18 sm:h-18 md:w-24 md:h-24 rounded-full border-3 border-white shadow-lg overflow-hidden bg-slate-200">
              <div
                className="w-full h-full flex items-center justify-center text-xl sm:text-3xl md:text-4xl font-black text-white"
                style={{ backgroundColor: myPlayer?.color || "#6366f1" }}
              >
                {playerName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
              </div>
            </div>
            <button
              onClick={onColorChange}
              className="absolute -bottom-0.5 -right-0.5 sm:bottom-0 sm:right-0 w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full border-3 sm:border-4 border-white shadow-md flex items-center justify-center transition-transform hover:scale-110 active:scale-90 text-xs sm:text-sm md:text-base"
              style={{ backgroundColor: myPlayer?.color }}
              title={t.color}
            >
              🎨
            </button>
          </div>

          {/* Name Input — takes remaining space on mobile */}
          <div className="flex-1 min-w-0 w-full">
            <input
              type="text"
              value={playerName}
              onChange={onPlayerNameChange}
              className="w-full text-center sm:text-center text-base sm:text-xl md:text-2xl font-black text-slate-700 bg-transparent border-b-3 sm:border-b-4 border-slate-200 focus:border-sky-500 focus:outline-none py-1 sm:py-2 uppercase placeholder:text-slate-300"
              placeholder={t.driverName.toUpperCase()}
            />

            {/* Online Player List — inline on mobile */}
            {gameMode === "online" && (
              <div className="mt-2 sm:mt-4 flex flex-col gap-1.5 sm:gap-2">
                <div className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest text-center">
                  {t.players} ({players.length})
                </div>
                <div className="flex flex-wrap gap-1 sm:gap-2 justify-center">
                  {players.map(p => {
                    const isMe = (networkManager.myId && p.id === networkManager.myId) ||
                      (p.isHost && p.id === players[0].id && onlineRole === "host");
                    return (
                      <div
                        key={p.id}
                        className="bg-white rounded-full px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs font-bold border flex items-center gap-1 shadow-sm text-slate-800"
                        title={p.name}
                      >
                        <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full" style={{ background: p.color }}></div>
                        {isMe ? playerName : p.name} {p.isHost ? "👑" : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Back Button */}
        <div className="p-1.5 sm:p-2 md:p-3 bg-slate-100 border-t-2 border-slate-200">
          <Button
            onClick={onBack}
            variant="ghost"
            className="w-full text-slate-400 font-bold hover:text-slate-600 hover:bg-slate-200 text-sm sm:text-base"
          >
            ◀ {t.backModes}
          </Button>
        </div>
      </div>

      {/* ── Right Panel: Race Settings ── */}
      <div className="flex-1 min-h-0 bg-white/90 backdrop-blur-md rounded-xl md:rounded-2xl shadow-xl border-3 border-white/50 p-2.5 sm:p-3 md:p-4 flex flex-col relative overflow-hidden">
        <div className="absolute top-0 right-0 w-20 sm:w-28 h-20 sm:h-28 bg-yellow-400 rounded-bl-[100%] z-0 opacity-20"></div>

        <div className="relative z-10 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 min-h-0">
          {isHost ? (
            <>
              {/* Track Selection */}
              <div className="flex-1 min-h-0 flex flex-col">
                <h3 className="text-xs sm:text-sm md:text-base font-black text-slate-800 uppercase italic mb-1.5 sm:mb-2 flex items-center gap-1.5 shrink-0">
                  <span className="text-orange-500">🏆</span> {t.trackSelect}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 sm:gap-2 md:gap-2.5 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                  {AVAILABLE_MAPS.map((map) => {
                    const isAvailable = map.id === "green-valley" || map.id === "cartoon-race-track-oval" || map.id === "generated-technical"; // Only these maps are available for selection, others are locked for development
                    return (
                      <button
                        key={map.id}
                        onClick={() => isAvailable && onMapChange(map)}
                        disabled={!isAvailable}
                        className={`relative group rounded-lg sm:rounded-xl overflow-hidden border-2 sm:border-3 transition-all duration-200 text-left h-14 sm:h-18 md:h-24 ${!isAvailable
                          ? "border-slate-300 opacity-40 cursor-not-allowed"
                          : selectedMap.id === map.id
                            ? "border-sky-500 shadow-xl scale-[1.02] ring-2 sm:ring-3 ring-sky-200 cursor-pointer"
                            : "border-white/50 opacity-80 hover:opacity-100 hover:scale-[1.02] hover:border-white hover:shadow-lg cursor-pointer"
                          }`}
                      >
                        <div className={`absolute inset-0 bg-linear-to-br ${getMapIdColor(map.id)}`}></div>
                        <div className={`absolute inset-0 ${!isAvailable ? 'bg-black/60' : 'bg-black/10 group-hover:bg-black/5'} transition-colors`}></div>
                        <div className="absolute inset-0 p-1.5 sm:p-2 md:p-3 flex flex-col justify-between">
                          <div className={`self-start px-1.5 sm:px-2 py-0.5 rounded-full text-[8px] sm:text-[10px] md:text-xs text-white font-bold uppercase backdrop-blur-sm border sm:border-2 shadow-sm ${getDifficultyColor(map.difficulty)}`}>
                            {map.difficulty}
                          </div>
                          <div className="font-black text-white text-[10px] sm:text-xs md:text-base italic uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] leading-tight">{map.name}</div>
                        </div>
                        {!isAvailable && (
                          <div className="absolute top-2 right-1 flex items-center justify-center">
                            <div className="bg-yellow-500/90 text-slate-900 px-1 py-0.5 sm:py-1 rounded-full text-[4px] sm:text-[1px] md:text-xs font-black uppercase border sm:border-2 border-yellow-300 shadow-lg">
                              🚧 Em Desenvolvimento
                            </div>
                          </div>
                        )}
                        {selectedMap.id === map.id && isAvailable && (
                          <div className="absolute top-1 right-1 sm:top-2 sm:right-2 bg-sky-500 text-white rounded-full p-0.5 sm:p-1 shadow-sm">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Laps */}
              <div className="shrink-0">
                <h3 className="text-xs sm:text-sm md:text-base font-black text-slate-800 uppercase italic mb-1 sm:mb-1.5 flex items-center gap-1.5">
                  <span className="text-purple-500">⏱️</span> {t.laps}
                </h3>
                <div className="flex gap-1 sm:gap-1.5 p-1 sm:p-1.5 bg-slate-100 rounded-lg sm:rounded-xl">
                  {[1, 2, 3, 5, 10].map(lap => (
                    <button
                      key={lap}
                      onClick={() => onLapsChange(lap)}
                      className={`flex-1 py-0.5 sm:py-1 md:py-1.5 rounded-md sm:rounded-lg font-black text-xs sm:text-sm md:text-base transition-all cursor-pointer ${laps === lap
                        ? "bg-white text-sky-500 shadow-md transform scale-105"
                        : "text-slate-400 hover:text-slate-600"
                        }`}
                    >
                      {lap}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-slate-600">
              <div className="text-4xl sm:text-6xl mb-2 sm:mb-4">⏳</div>
              <h3 className="text-lg sm:text-2xl font-black uppercase text-slate-500">{t.waitingForHost}</h3>
              <p className="font-bold text-slate-700 text-sm sm:text-base">{t.mapLabel}: {selectedMap.name}</p>
              <p className="font-bold text-slate-700 text-sm sm:text-base">{t.lapsLabel}: {laps}</p>
            </div>
          )}
        </div>

        {/* Start / Waiting */}
        <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t-2 border-slate-100 relative z-10 shrink-0">
          {isHost ? (
            <Button
              onClick={onStartGame}
              className="w-full py-2.5 sm:py-4 md:py-6 text-base sm:text-xl md:text-2xl font-black italic uppercase rounded-lg sm:rounded-xl bg-linear-to-r from-green-400 to-emerald-600 hover:from-green-300 hover:to-emerald-500 text-white shadow-[0_3px_0_rgb(5,150,105)] sm:shadow-[0_5px_0_rgb(5,150,105)] active:shadow-none active:translate-y-0.5 sm:active:translate-y-1 transition-all transform hover:scale-[1.01]"
            >
              {t.goRace} 🏁
            </Button>
          ) : (
            <div className="text-center font-bold text-slate-400 animate-pulse text-sm sm:text-base">
              {t.hostConfiguring}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
