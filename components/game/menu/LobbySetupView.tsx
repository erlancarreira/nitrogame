"use client";

import { Button } from "@/components/ui/button";
import type { TEXTS } from "@/lib/game/i18n";

interface LobbySetupViewProps {
  t: (typeof TEXTS)["en"];
  inputCode: string;
  onInputCodeChange: (code: string) => void;
  connectionStatus: string;
  onCreateHost: () => void;
  onJoinLobby: () => void;
  onBack: () => void;
}

export function LobbySetupView({
  t, inputCode, onInputCodeChange, connectionStatus,
  onCreateHost, onJoinLobby, onBack,
}: LobbySetupViewProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center space-y-4 sm:space-y-8 animate-in zoom-in-90 duration-300">
      <div className="bg-white/90 backdrop-blur-sm p-5 sm:p-8 rounded-2xl sm:rounded-[3rem] border-4 border-white shadow-2xl w-full max-w-lg mx-auto">
        <h2 className="text-xl sm:text-3xl font-black text-center text-slate-800 uppercase tracking-widest mb-4 sm:mb-6 border-b-4 border-slate-200 pb-2">
          {t.multiplayer}
        </h2>

        <div className="space-y-3 sm:space-y-4">
          <button
            onClick={onCreateHost}
            className="w-full bg-green-500 hover:bg-green-400 text-white p-3 sm:p-4 rounded-2xl font-black text-lg sm:text-xl mb-3 sm:mb-4 shadow-lg uppercase cursor-pointer"
          >
            {t.createLobby}
          </button>

          <div className="flex flex-col gap-2">
            <p className="text-center font-bold text-slate-500 text-sm sm:text-base">{t.orJoinExisting}</p>
            <input
              value={inputCode}
              onChange={e => onInputCodeChange(e.target.value.toUpperCase())}
              placeholder={t.enterLobbyCode}
              className="w-full p-3 sm:p-4 rounded-xl border-4 border-slate-200 font-bold text-center text-lg sm:text-xl uppercase bg-white text-slate-800 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
            />
            <button
              onClick={onJoinLobby}
              className="w-full bg-blue-500 hover:bg-blue-400 text-white p-3 sm:p-4 rounded-2xl font-black text-lg sm:text-xl shadow-lg uppercase cursor-pointer"
            >
              {t.joinLobby}
            </button>
          </div>

          <div className="text-center mt-3 sm:mt-4">
            <Button variant="ghost" onClick={onBack} className="text-slate-500 font-bold">
              {t.cancel}
            </Button>
          </div>

          {connectionStatus && (
            <p className="text-center font-bold text-sky-600 animate-pulse text-sm sm:text-base">
              {connectionStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
