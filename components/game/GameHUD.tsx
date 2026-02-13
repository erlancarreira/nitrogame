"use client";

import React, { useState, useEffect, useMemo } from "react";

import type { Player } from "@/lib/game/types";
import type { MapConfig } from "@/lib/game/maps";
import { TEXTS, getPositionSuffix, type Language } from "@/lib/game/i18n";
import { MiniMap } from "./MiniMap";

interface RacerPosition {
  id: string;
  name: string;
  color: string;
  position: number;
  lap: number;
  lapProgress: number;
  isPlayer: boolean;
  finished: boolean;
  finishTime?: number;
  kartPosition?: [number, number, number];
  kartRotation?: number;
}

interface GameHUDProps {
  speed: number;
  lap: number;
  totalLaps: number;
  position: number;
  totalRacers: number;
  time: number;
  fps?: number;
  frameMs?: number;
  ping?: number;
  debug?: boolean;
  gameState: "waiting" | "countdown" | "racing" | "paused" | "finished";
  countdown: number;
  players: Player[];
  racerPositions: RacerPosition[];
  map: MapConfig;
  item: "none" | "mushroom" | "banana" | "red_shell" | "star" | "oil";
  onMapSelect?: (map: MapConfig) => void;
  onDifficultySelect?: (difficulty: "easy" | "medium" | "hard") => void;
  onBackToLobby?: () => void;
  onBackToMenu?: () => void;
  onRematch?: () => void;
  rematchEnabled?: boolean;
  onResume?: () => void;
  isTouch?: boolean;
}

export const GameHUD = React.memo(function GameHUD({
  speed,
  lap,
  totalLaps,
  position,
  totalRacers,
  time,
  fps,
  frameMs,
  ping = -1,
  debug = false,
  gameState,
  countdown,
  racerPositions,
  map,
  item = "none",
  onBackToMenu,
  onRematch,
  rematchEnabled = true,
  onResume,
  isTouch = false,
}: GameHUDProps) {
  const [lang, setLang] = useState<Language>("en");

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const nav = navigator as Navigator & { userLanguage?: string };
      const userLang = nav.language || nav.userLanguage;
      if (userLang && userLang.toLowerCase().includes("pt")) {
        setLang("pt");
      }
    }
  }, []);

  const t = TEXTS[lang];

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = Math.floor((ms % 1000) / 10);
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds
      .toString()
      .padStart(2, "0")}`;
  };

  // Sort for display: finished racers first (by finishTime), then unfinished (by position/progress)
  const sortedRacers = useMemo(() =>
    [...racerPositions].sort((a, b) => {
      if (a.finished && b.finished) {
        return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
      }
      if (a.finished) return -1;
      if (b.finished) return 1;
      return a.position - b.position;
    }),
    [racerPositions]
  );

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
      {/* Countdown overlay */}
      {gameState === "countdown" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-100">
          <div className="text-center animate-in zoom-in duration-300">
            <div className="text-8xl md:text-9xl font-black italic text-primary drop-shadow-[0_4px_0_rgba(0,0,0,0.5)] mb-4 tracking-tighter">
              {countdown > 0 ? countdown : t.go}
            </div>
            <div className="text-2xl md:text-4xl text-white font-bold uppercase tracking-widest drop-shadow-md">
              {map.name}
            </div>
          </div>
        </div>
      )}

      {/* Pause overlay */}
      {gameState === "paused" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md z-100">
          <div className="bg-white/10 border border-white/20 rounded-2xl px-6 py-5 md:px-10 md:py-8 shadow-2xl pointer-events-auto w-[90%] max-w-md text-center">
            <div className="text-3xl md:text-4xl font-black text-white mb-4">{t.pauseTitle}</div>
            <div className="text-white/70 text-sm md:text-base mb-6">{t.pauseHint}</div>
            <div className="flex flex-col gap-3">
              <button
                className="w-full py-3 rounded-xl bg-white text-black font-bold uppercase tracking-wide hover:scale-105 active:scale-95 transition-transform"
                onClick={onResume}
              >
                {t.pauseResume}
              </button>
              <button
                className="w-full py-3 rounded-xl bg-white/10 text-white font-bold uppercase tracking-wide border border-white/20 hover:bg-white/15 active:scale-95 transition-all"
                onClick={onBackToMenu}
              >
                {t.pauseBack}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top HUD - Compact Row on Mobile, Spaced on Desktop */}
      <div className="absolute top-2 md:top-4 left-0 right-0 flex justify-center items-start gap-2 md:gap-4 px-2 z-10" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>

        {/* Lap counter */}
        <div className="bg-black/60 backdrop-blur-md rounded-xl px-3 py-1 md:px-5 md:py-2 border border-white/10 flex flex-col items-center min-w-15 md:min-w-20">
          <div className="text-white/50 text-[10px] md:text-xs font-bold uppercase tracking-wider">{t.lap}</div>
          <div className="text-lg md:text-2xl font-black text-white leading-none">
            {lap}<span className="text-white/40 text-sm md:text-lg">/{totalLaps}</span>
          </div>
        </div>

        {/* Timer */}
        <div className="bg-black/60 backdrop-blur-md rounded-xl px-3 py-1 md:px-6 md:py-2 border border-white/10 flex flex-col items-center min-w-20 md:min-w-30">
          <div className="text-white/50 text-[10px] md:text-xs font-bold uppercase tracking-wider">{t.time}</div>
          <div className="text-lg md:text-2xl font-black text-white font-mono leading-none tracking-tight">
            {formatTime(time)}
          </div>
        </div>

        {/* Position */}
        <div className="bg-black/60 backdrop-blur-md rounded-xl px-3 py-1 md:px-6 md:py-2 border border-white/10 flex flex-col items-center min-w-15 md:min-w-25">
          <div className="text-white/50 text-[10px] md:text-xs font-bold uppercase tracking-wider">{t.pos}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl md:text-4xl font-black text-primary italic leading-none">
              {position}
              <span className="text-sm md:text-xl not-italic text-primary/80">{getPositionSuffix(position, lang)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Standings - Floats Top Left on Desktop, Compact on Mobile */}
      <div className="absolute top-14 left-1 md:top-4 md:left-4 z-0 md:z-10 bg-black/40 backdrop-blur-sm rounded-lg md:rounded-xl p-1.5 md:p-3 border border-white/10 w-20 md:w-48 origin-top-left transition-all" style={{ marginTop: "env(safe-area-inset-top, 0px)", marginLeft: "env(safe-area-inset-left, 0px)" }}>
        <div className="text-[8px] md:text-xs font-bold text-white/40 mb-0.5 md:mb-2 uppercase tracking-wider">{t.leaderboard}</div>
        <div className="space-y-0.5 md:space-y-1">
          {sortedRacers.slice(0, 4).map((racer, index) => (
            <div
              key={racer.id}
              className={`flex items-center gap-1 md:gap-2 px-1 md:px-2 py-0.5 md:py-1 rounded-md transition-colors ${racer.isPlayer ? "bg-primary/30 border border-primary/20" : "bg-white/5"
                }`}
            >
              <span className="text-[10px] md:text-sm font-black text-white/60 w-3 md:w-4">
                {index + 1}
              </span>
              <div
                className="w-1.5 h-1.5 md:w-3 md:h-3 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: racer.color }}
              />
              <span
                className={`text-[10px] md:text-sm font-bold truncate ${racer.isPlayer ? "text-primary-foreground" : "text-white/80"
                  }`}
              >
                <span className="md:hidden">{racer.name.slice(0, 3)}</span>
                <span className="hidden md:inline">{racer.name}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Mini map - Floats Top Right */}
      <div className="absolute top-14 right-1 md:top-4 md:right-4 z-0 md:z-10 flex flex-col items-center" style={{ marginTop: "env(safe-area-inset-top, 0px)", marginRight: "env(safe-area-inset-right, 0px)" }}>
        <div className="w-20 h-20 md:w-40 md:h-40 bg-black/70 backdrop-blur-md rounded-xl md:rounded-2xl border border-white/15 overflow-hidden shadow-xl">
          <div className="w-full h-full flex items-center justify-center p-1 md:p-2">
            <MiniMap map={map} racers={sortedRacers} />
          </div>
        </div>
        <div className="mt-0.5 text-center text-[7px] md:text-[10px] font-bold text-white/40 uppercase tracking-widest">
          {map.name}
        </div>
      </div>

      {/* Controls / Info (Bottom) — hidden on touch devices since MobileControls handles it */}
      <div className={`absolute bottom-0 left-0 right-0 p-4 md:p-8 flex items-end justify-between pointer-events-none ${isTouch ? "hidden" : ""}`} style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>

        {/* Left Control Visualizer (D-PAD style) — desktop only */}
        <div className="relative opacity-70 flex flex-col items-center mb-4">
          <div className="text-[10px] text-white/30 mb-2 font-bold uppercase tracking-wider text-center">{t.controls}</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div />
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/50 font-black text-sm">W</div>
            <div />
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/50 font-black text-sm">A</div>
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/50 font-black text-sm">S</div>
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/50 font-black text-sm">D</div>
          </div>
          <div className="flex gap-2">
            <div className="h-10 px-3 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/50 font-black text-[10px]">
              SPACE <span className="text-[8px] font-normal ml-1 opacity-70">(DRIFT)</span>
            </div>
            <div className="h-10 px-3 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/50 font-black text-[10px]">
              SHIFT <span className="text-[8px] font-normal ml-1 opacity-70">(ITEM)</span>
            </div>
          </div>
        </div>

        {/* Center: Debug Info */}
        {debug && (
          <div className="bg-black/80 backdrop-blur rounded-lg p-2 border border-white/10 text-[10px] font-mono text-green-400">
            FPS: {fps}<br />
            MS: {frameMs}<br />
            {ping >= 0 && <>PING: {ping}ms<br /></>}
            T: {time}
          </div>
        )}

        {/* Right: Speedometer & Item — desktop only */}
        <div className="flex flex-row items-end gap-4 pointer-events-auto">

          {/* Item Slot */}
          <div className="relative transition-all">
            <div className="w-24 h-24 bg-black/60 backdrop-blur-xl rounded-2xl border-4 border-white/20 flex items-center justify-center relative overflow-hidden shadow-xl mb-2">
              {/* Background Pattern */}
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-white to-transparent" />

              {item === "none" && (
                <div className="text-white/20 font-black text-4xl animate-pulse">?</div>
              )}

              {item === "mushroom" && (
                <div className="animate-in zoom-in spin-in-180 duration-500">
                  <div className="text-5xl drop-shadow-lg filter pb-2">🍄</div>
                </div>
              )}

              {item === "banana" && (
                <div className="animate-in zoom-in duration-300">
                  <div className="text-5xl drop-shadow-lg filter pb-2">🍌</div>
                </div>
              )}

              {item === "red_shell" && (
                <div className="animate-in zoom-in duration-300">
                  <div className="text-5xl drop-shadow-lg filter pb-2">🚀</div>
                </div>
              )}

              {item === "star" && (
                <div className="animate-in zoom-in spin-in-180 duration-500">
                  <div className="text-5xl drop-shadow-[0_0_15px_rgba(255,215,0,0.8)] filter pb-2 animate-pulse">⭐</div>
                </div>
              )}

              {item === "oil" && (
                <div className="animate-in zoom-in duration-300">
                  <div className="text-5xl drop-shadow-lg filter pb-2 opacity-80">⚫</div>
                </div>
              )}

              {/* Key Hint */}
              {item !== "none" && (
                <div className="absolute bottom-1 right-1 bg-white text-black text-[8px] font-black px-1 rounded">SHIFT</div>
              )}
            </div>
          </div>

          {/* Speedometer */}
          <div className={`bg-black/60 backdrop-blur-xl rounded-full w-32 h-32 border-4 flex flex-col items-center justify-center shadow-2xl relative overflow-hidden transition-colors duration-200 ${speed > 45 ? "border-orange-500 shadow-orange-500/50" : "border-white/5"}`}>
            <div className="absolute inset-0 bg-linear-to-t from-primary/20 to-transparent opacity-50" />
            <div className={`relative z-10 flex flex-col items-center transition-colors duration-200 ${speed > 45 ? "text-orange-400" : "text-white"}`}>
              <span className={`text-5xl font-black italic tracking-tighter ${speed > 45 ? "animate-pulse" : ""}`}>
                {Math.round(speed || 0)}
              </span>
              <span className="text-xs font-bold text-primary uppercase tracking-widest mt-1">
                KM/H
              </span>
              <div className="mt-2 text-white/40 text-xs font-bold uppercase tracking-widest flex items-center gap-1">
                GEAR <span className="text-2xl text-white font-black italic">{
                  (speed || 0) > 160 ? 6 :
                    (speed || 0) > 125 ? 5 :
                      (speed || 0) > 90 ? 4 :
                        (speed || 0) > 60 ? 3 :
                          (speed || 0) > 30 ? 2 : 1
                }</span>
              </div>
            </div>
            {/* Progress Ring */}
            <svg className="absolute inset-0 w-full h-full -rotate-90 p-1">
              <circle
                cx="50%" cy="50%" r="45%"
                fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4"
              />
              <circle
                cx="50%" cy="50%" r="45%"
                fill="none" stroke="currentColor" strokeWidth="4"
                className={`transition-all duration-300 ${speed > 45 ? "text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.8)]" : "text-primary"}`}
                strokeDasharray="283"
                strokeDashoffset={283 - (Math.min((speed || 0), 100) / 100) * 283}
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Mobile: Compact speed + item indicator */}
      {isTouch && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex items-center gap-2" style={{ marginTop: "env(safe-area-inset-top, 0px)" }}>
          {/* Item (mobile) */}
          {item !== "none" && (
            <div className="w-10 h-10 bg-black/50 backdrop-blur-sm rounded-xl border border-orange-500/50 flex items-center justify-center animate-pulse">
              <span className="text-xl">
                {item === "mushroom" ? "🍄" : item === "banana" ? "🍌" : item === "red_shell" ? "🚀" : item === "star" ? "⭐" : "⚫"}
              </span>
            </div>
          )}
          {/* Speed (mobile) */}
          <div className={`bg-black/50 backdrop-blur-sm rounded-full px-3 py-0.5 border transition-colors duration-200 ${speed > 45 ? "border-orange-500/50" : "border-white/10"}`}>
            <span className={`text-lg font-black italic tracking-tighter ${speed > 45 ? "text-orange-400" : "text-white"}`}>
              {Math.round(speed || 0)}
            </span>
            <span className="text-[8px] font-bold text-white/40 uppercase ml-1">km/h</span>
          </div>
        </div>
      )}

      {/* Finished overlay */}
      {gameState === "finished" && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md pointer-events-auto z-50 overflow-y-auto"
          style={{ padding: "max(env(safe-area-inset-top, 0px), 0.75rem) max(env(safe-area-inset-right, 0px), 0.75rem) max(env(safe-area-inset-bottom, 0px), 0.75rem) max(env(safe-area-inset-left, 0px), 0.75rem)" }}
        >
          <div className="bg-slate-900/90 p-4 md:p-6 rounded-2xl md:rounded-3xl border border-white/10 text-center w-full max-w-4xl shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col gap-4 md:gap-6 max-h-[90vh]">
            <div className="space-y-1">
              <div className="text-2xl md:text-4xl font-black italic text-transparent bg-clip-text bg-linear-to-r from-yellow-400 to-orange-500 drop-shadow-sm">
                {t.raceComplete}
              </div>
              <div className="text-white/70 text-sm md:text-base">
                {t.yourTime} <span className="text-white font-mono font-semibold">{formatTime(time)}</span>
              </div>
            </div>

            {/* Results */}
            <div className="bg-black/35 rounded-xl md:rounded-2xl p-3 md:p-4 border border-white/10 flex-1 min-h-0">
              <div className="text-[10px] md:text-xs font-bold text-white/35 uppercase tracking-widest mb-2 md:mb-3">{t.finalResults}</div>
              <div className="space-y-1.5 md:space-y-2 max-h-[50vh] overflow-y-auto pr-1 md:pr-2">
                {sortedRacers.map((racer, index) => (
                  <div
                    key={racer.id}
                    className={`flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg md:rounded-xl transition-all ${racer.isPlayer ? "bg-primary/25 border border-primary/20" : "bg-white/5"
                      }`}
                  >
                    <span className={`text-sm md:text-lg font-black w-6 md:w-8 text-right ${index === 0 ? "text-yellow-400" : "text-white/60"}`}>
                      {index + 1}
                    </span>
                    <div className="w-5 md:w-8 h-1 rounded-full shrink-0" style={{ backgroundColor: racer.color }} />
                    <span className={`font-bold grow text-left text-xs md:text-base truncate ${racer.isPlayer ? "text-white" : "text-white/80"}`}>
                      {racer.name}
                    </span>
                    {racer.finished && racer.finishTime ? (
                      <span className="text-[10px] md:text-sm text-white/50 font-mono font-medium shrink-0">
                        {formatTime(racer.finishTime)}
                      </span>
                    ) : !racer.finished ? (
                      <span className="text-[10px] md:text-sm text-red-400/70 font-mono font-bold shrink-0">
                        DNF
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="grid md:grid-cols-2 gap-2 md:gap-3">
              {onRematch && (
                <button
                  className={`w-full py-3 md:py-4 rounded-xl ${rematchEnabled ? "bg-primary text-primary-foreground hover:scale-[1.02]" : "bg-white/10 text-white/50 cursor-not-allowed"} font-black uppercase tracking-widest text-sm md:text-base transition-all shadow-lg shadow-primary/15`}
                  onClick={rematchEnabled ? onRematch : undefined}
                  disabled={!rematchEnabled}
                >
                  {rematchEnabled ? t.rematch : t.rematchHostOnly}
                </button>
              )}
              <button
                className="w-full py-3 md:py-4 rounded-xl bg-white text-black font-black uppercase tracking-widest text-sm md:text-base hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-white/10"
                onClick={onBackToMenu}
              >
                {t.backToMenu}
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
});
