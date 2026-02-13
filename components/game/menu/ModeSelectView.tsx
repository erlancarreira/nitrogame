"use client";

import React from "react";
import type { TEXTS } from "@/lib/game/i18n";

interface ModeSelectViewProps {
  t: (typeof TEXTS)["en"];
  onSelectMode: (mode: "local" | "online") => void;
}

export function ModeSelectView({ t, onSelectMode }: ModeSelectViewProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center space-y-4 sm:space-y-8 animate-in zoom-in-90 duration-300">
      <div className="bg-white/90 backdrop-blur-sm p-5 sm:p-8 rounded-2xl sm:rounded-[3rem] border-4 border-white shadow-2xl w-full max-w-lg mx-auto transform rotate-1">
        <h2 className="text-xl sm:text-3xl font-black text-center text-slate-800 uppercase tracking-widest mb-4 sm:mb-6 border-b-4 border-slate-200 pb-2">
          {t.mode}
        </h2>

        <div className="space-y-3 sm:space-y-4">
          <button
            onClick={() => onSelectMode("local")}
            className="w-full group relative bg-linear-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white rounded-2xl sm:rounded-3xl p-3 sm:p-4 transition-all hover:scale-105 hover:-rotate-1 shadow-[0_6px_0_rgb(180,83,9)] active:shadow-none active:translate-y-1.5 cursor-pointer"
          >
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              <span className="text-3xl sm:text-4xl filter drop-shadow-md">🎮</span>
              <div className="text-left">
                <div className="text-lg sm:text-2xl font-black italic uppercase drop-shadow-md tracking-wider">{t.localRace}</div>
                <div className="text-yellow-100 font-bold text-[10px] sm:text-xs uppercase opacity-90">{t.localDesc}</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("online")}
            className="w-full group relative bg-linear-to-r from-blue-400 to-indigo-500 hover:from-blue-300 hover:to-indigo-400 text-white rounded-2xl sm:rounded-3xl p-3 sm:p-4 transition-all hover:scale-105 hover:rotate-1 shadow-[0_6px_0_rgb(29,78,216)] active:shadow-none active:translate-y-1.5 cursor-pointer"
          >
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              <span className="text-3xl sm:text-4xl filter drop-shadow-md">🌍</span>
              <div className="text-left">
                <div className="text-lg sm:text-2xl font-black italic uppercase drop-shadow-md tracking-wider">{t.onlineMulti}</div>
                <div className="text-blue-100 font-bold text-[10px] sm:text-xs uppercase opacity-90">{t.onlineDesc}</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <div className="text-white/80 font-bold text-xs sm:text-sm bg-black/20 px-3 sm:px-4 py-2 rounded-full backdrop-blur-md">
        v1.0 • Press F11 for Fullscreen
      </div>
    </div>
  );
}
