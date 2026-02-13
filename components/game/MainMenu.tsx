"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useGLTF, Loader } from "@react-three/drei";

import { MAPS, type MapConfig } from "@/lib/game/maps";
import { CAR_PACKS, DEFAULT_CAR_MODEL, getNextCarModelInPack, getNextPackId, getPackById } from "@/lib/game/cars";
import { type Player, KART_COLORS, BOT_NAMES } from "@/lib/game/types";
import { TEXTS } from "@/lib/game/i18n";
import { networkManager } from "@/lib/game/networking";
import { soundManager } from "@/lib/game/sound-manager";
import { Volume2, VolumeX, Settings as SettingsIcon, X as CloseIcon, HelpCircle } from "lucide-react";

import { MenuBackground } from "./menu/MenuBackground";
import { ModeSelectView } from "./menu/ModeSelectView";
import { LobbySetupView } from "./menu/LobbySetupView";
import { LobbyView } from "./menu/LobbyView";
import { useOnlineLobby } from "./menu/useOnlineLobby";

interface MainMenuProps {
  onStartGame: (players: Player[], map: MapConfig, laps: number, localPlayerId?: string, serverRaceStartTime?: number) => void;
  isLoading?: boolean;
}

export function MainMenu({ onStartGame, isLoading = false }: MainMenuProps) {
  // ---- Audio ----
  const [muted, setMuted] = useState(soundManager.muted);
  const [volume, setVolume] = useState(soundManager.masterVolume);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const unlockAudio = useCallback(() => {
    if (audioUnlocked) return;

    // Resume context if suspended
    if (typeof window !== 'undefined' && 'AudioContext' in window) {
      if (Howler.ctx && Howler.ctx.state === 'suspended') {
        Howler.ctx.resume();
      }
    }

    soundManager.playIntroMusic();
    setAudioUnlocked(true);
  }, [audioUnlocked]);

  useEffect(() => {
    const handleInteraction = () => unlockAudio();
    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
    window.addEventListener("touchstart", handleInteraction);
    return () => {
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };
  }, [unlockAudio]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    soundManager.setMasterVolume(newVol);
    if (muted && newVol > 0) {
      setMuted(false);
      if (soundManager.muted) soundManager.toggleMute();
    }
  };

  // ---- Language ----
  const [lang, setLang] = useState<"en" | "pt">("en");
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const nav = navigator as Navigator & { userLanguage?: string };
      const userLang = nav.language || nav.userLanguage;
      if (userLang?.toLowerCase().includes("pt")) setLang("pt");
    }
  }, []);
  const t = TEXTS[lang];

  // ---- Core State ----
  const [view, setView] = useState<"mode" | "lobby-setup" | "lobby">("mode");
  const [initialName] = useState(() => "Player " + Math.floor(Math.random() * 1000));
  const [playerName, setPlayerName] = useState(initialName);
  const [players, setPlayers] = useState<Player[]>([{
    id: "player-1",
    name: initialName,
    color: KART_COLORS[0].color,
    modelUrl: DEFAULT_CAR_MODEL,
    modelPackId: CAR_PACKS[0].id,
    isBot: false,
    isHost: true,
    isReady: true,
  }]);
  const [selectedMap, setSelectedMap] = useState<MapConfig>(MAPS[0]);
  const [laps, setLaps] = useState(3);
  const maxPlayers = 8;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graphicsQuality, setGraphicsQuality] = useState<"high" | "low">(() => {
    if (typeof localStorage === "undefined") return "high";
    const stored = localStorage.getItem("nr-quality");
    return stored === "low" ? "low" : "high";
  });
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // ---- Online Lobby Hook ----
  const online = useOnlineLobby({
    t, playerName, players, setPlayers,
    selectedMap, setSelectedMap, laps, setLaps,
    setView, onStartGame,
  });

  // ---- Sync player name → players array (debounced) ----
  useEffect(() => {
    const timer = setTimeout(() => {
      setPlayers(prev => {
        const myNetId = networkManager.myId;
        return prev.map(p => {
          const isMe = p.id === myNetId || p.id === "player-1" || (!p.isBot && p.isHost);
          if (isMe && p.name !== playerName) return { ...p, name: playerName };
          return p;
        });
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [playerName]);

  // ---- Player Update Helpers ----
  const updatePlayer = (id: string, updates: Partial<Player>) => {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleLaps = useCallback((newLaps: number) => {
    setLaps(newLaps);
  }, [setLaps]);
  

  const getMyId = () => networkManager.myId || "player-1";

  const handleColorChange = useCallback(() => {
    const myId = getMyId();
    const p = players.find(p => p.id === myId) || players[0];
    if (!p) return;
    const currentIndex = KART_COLORS.findIndex(c => c.color === p.color);
    updatePlayer(p.id, { color: KART_COLORS[(currentIndex + 1) % KART_COLORS.length].color });
  }, [players]);

  const handleModelChange = useCallback(() => {
    const myId = getMyId();
    const p = players.find(p => p.id === myId) || players[0];
    if (!p) return;
    const nextModel = getNextCarModelInPack(p.modelPackId, p.modelUrl);
    if (nextModel.toLowerCase().endsWith(".glb")) useGLTF.preload(nextModel);
    updatePlayer(p.id, { modelUrl: nextModel });
  }, [players]);

  const handlePackChange = useCallback(() => {
    const myId = getMyId();
    const p = players.find(p => p.id === myId) || players[0];
    if (!p) return;
    const nextPackId = getNextPackId(p.modelPackId);
    const pack = getPackById(nextPackId);
    if (pack.models[0].toLowerCase().endsWith(".glb")) useGLTF.preload(pack.models[0]);
    updatePlayer(p.id, { modelPackId: nextPackId, modelUrl: pack.models[0] });
  }, [players]);

  // ---- Bot Management (local mode only) ----
  const botIdRef = useRef(1);
  const getRandomModelFromPack = useCallback((packId: string) => {
    const pack = getPackById(packId);
    return pack.models[Math.floor(Math.random() * pack.models.length)] ?? pack.models[0];
  }, []);

  const createBot = useCallback((index: number, packId: string, color: string): Player => {
    const botName = BOT_NAMES[index] || `Bot ${index + 1}`;
    return {
      id: `bot-${botIdRef.current++}`,
      name: botName,
      color,
      modelPackId: packId,
      modelUrl: getRandomModelFromPack(packId),
      isBot: true,
      isHost: false,
      isReady: true,
    };
  }, [getRandomModelFromPack]);

  useEffect(() => {
    if (view !== "lobby" || online.gameMode === "online") return;

    const host = players.find(p => p.isHost);
    const hostPackId = host?.modelPackId ?? CAR_PACKS[0].id;
    let next = [...players];
    let changed = false;

    if (next.length > maxPlayers) {
      const withoutBots = next.filter(p => !p.isBot);
      const bots = next.filter(p => p.isBot).slice(0, Math.max(0, next.filter(p => p.isBot).length - (next.length - maxPlayers)));
      next = [...withoutBots, ...bots];
      changed = true;
    }

    next = next.map(p => {
      if (!p.isBot || p.modelPackId === hostPackId) return p;
      changed = true;
      return { ...p, modelPackId: hostPackId, modelUrl: getRandomModelFromPack(hostPackId) };
    });

    const missing = maxPlayers - next.length;
    if (missing > 0) {
      const used = new Set(next.map(p => p.color));
      const available = KART_COLORS.filter(c => !used.has(c.color));
      for (let i = 0; i < missing; i++) {
        const color = available[i]?.color || KART_COLORS[(next.length + i) % KART_COLORS.length].color;
        used.add(color);
        next.push(createBot(next.filter(p => p.isBot).length, hostPackId, color));
      }
      changed = true;
    }

    if (changed) setPlayers(next);
  }, [players.length, view, online.gameMode]);

  // ---- Start Game ----
  const handleStartGame = useCallback(() => {
    let finalPlayers = players.map(p => {
      const isMe = p.id === networkManager.myId || p.id === "player-1" || (!p.isBot && p.isHost);
      return isMe ? { ...p, name: playerName } : p;
    });

    if (online.isHost) {
      const missing = maxPlayers - finalPlayers.length;
      if (missing > 0) {
        const hostPackId = finalPlayers[0]?.modelPackId ?? CAR_PACKS[0].id;
        const usedColors = new Set(finalPlayers.map(p => p.color));
        const availableColors = KART_COLORS.filter(c => !usedColors.has(c.color));
        for (let i = 0; i < missing; i++) {
          const color = availableColors[i % availableColors.length]?.color || KART_COLORS[i % KART_COLORS.length].color;
          finalPlayers.push(createBot(finalPlayers.filter(p => p.isBot).length, hostPackId, color));
        }
      }
    }

    if (online.gameMode === "online" && online.onlineRole === "host") {
      soundManager.stopIntroMusic();
      networkManager.emitStartGame({
        mapId: selectedMap.id,
        laps,
        players: finalPlayers,
      });
      return; // Wait for server echo with raceStartTime
    }

    soundManager.stopIntroMusic();
    onStartGame(finalPlayers, selectedMap, laps, players[0]?.id || "player-1");
  }, [players, playerName, selectedMap, laps, online.isHost, online.gameMode, online.onlineRole, createBot, onStartGame]);

  // ---- Back to Modes ----
  const handleBackToModes = useCallback(() => {
    online.cleanup();
    setView("mode");
    setPlayers([{
      id: "player-1",
      name: playerName,
      color: KART_COLORS[0].color,
      modelUrl: DEFAULT_CAR_MODEL,
      modelPackId: CAR_PACKS[0].id,
      isBot: false,
      isHost: true,
      isReady: true,
    }]);
  }, [playerName, online]);

  // ---- Render ----
  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden select-none font-sans">
      <MenuBackground />



      {/* Audio + Settings + Tutorial Controls */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <div className="flex items-center gap-2 p-2 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors">
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={handleVolumeChange}
            className="w-24 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yellow-400"
            title={t.settingsVolume}
          />
          <button
            onClick={() => {
              const isMuted = soundManager.toggleMute();
              setMuted(isMuted);
            }}
            className="p-1 text-white hover:text-yellow-400 transition-colors cursor-pointer"
            title={muted ? t.settingsUnmute : t.settingsMute}
          >
            {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-full bg-white/80 text-slate-800 hover:bg-white transition-colors shadow-lg cursor-pointer"
          title={t.settingsTitle}
        >
          <SettingsIcon size={20} />
        </button>
        <button
          onClick={() => setTutorialOpen(true)}
          className="p-2 rounded-full bg-white/80 text-slate-800 hover:bg-white transition-colors shadow-lg cursor-pointer"
          title={t.howtoTitle}
        >
          <HelpCircle size={20} />
        </button>
      </div>

      <div className="absolute inset-0 z-10 flex flex-col p-3 sm:p-4 md:p-8 overflow-y-auto md:overflow-hidden">
        {/* Logo — same size on all views, reduced bottom margin in lobby */}
        <div className={`flex flex-col items-center justify-center shrink-0 transition-all duration-300 ${view === "lobby" ? "mb-1 sm:mb-2" : "mb-3 sm:mb-6"}`}>
          <div className="relative transform hover:scale-105 transition-transform duration-300">
            <h1
              className="font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-yellow-300 to-orange-500 drop-shadow-[0_5px_0_rgba(180,83,9,1)] text-4xl sm:text-6xl md:text-8xl"
              style={{ WebkitTextStroke: "2px #78350f", filter: "drop-shadow(0 10px 0 rgba(0,0,0,0.2))" }}
            >
              NITRO
            </h1>
            <h1
              className="font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-red-500 to-red-700 drop-shadow-[0_5px_0_rgba(153,27,27,1)] relative text-4xl sm:text-6xl md:text-8xl -mt-2 sm:-mt-4 md:-mt-6 ml-6 sm:ml-12"
              style={{ WebkitTextStroke: "2px #450a0a", filter: "drop-shadow(0 10px 0 rgba(0,0,0,0.2))" }}
            >
              RUSH
            </h1>
            {view !== "lobby" && (
              <>
                <div className="absolute -top-2 -right-4 sm:-top-4 sm:-right-8 text-2xl sm:text-4xl animate-bounce">✨</div>
                <div className="absolute bottom-0 -left-4 sm:-left-8 text-2xl sm:text-4xl animate-bounce delay-75">✨</div>
              </>
            )}
          </div>
        </div>

        {/* Views */}
        {view === "mode" && (
          <ModeSelectView t={t} onSelectMode={online.handleSelectMode} />
        )}

        {view === "lobby-setup" && (
          <LobbySetupView
            t={t}
            inputCode={online.inputCode}
            onInputCodeChange={online.setInputCode}
            connectionStatus={online.connectionStatus}
            onCreateHost={online.startOnlineHost}
            onJoinLobby={online.joinOnlineLobby}
            onBack={() => setView("mode")}
          />
        )}

        {view === "lobby" && (
          <LobbyView
            t={t}
            gameMode={online.gameMode}
            isHost={online.isHost}
            onlineRole={online.onlineRole}
            lobbyCode={online.lobbyCode}
            players={players}
            playerName={playerName}
            selectedMap={selectedMap}
            laps={laps}
            onPlayerNameChange={(e) => setPlayerName(e.target.value)}
            onColorChange={handleColorChange}
            onModelChange={handleModelChange}
            onPackChange={handlePackChange}
            onMapChange={setSelectedMap}
            onLapsChange={handleLaps}
            onStartGame={handleStartGame}
            onBack={handleBackToModes}
          />
        )}
      </div>

      {isLoading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-100 flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="text-4xl font-black italic text-white animate-pulse">
            {t.loading.toUpperCase()}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="absolute inset-0 z-120 bg-black/70 backdrop-blur-md flex items-center justify-center">
          <div className="bg-white/10 border border-white/20 rounded-2xl p-6 md:p-8 w-[90%] max-w-xl shadow-2xl relative pointer-events-auto">
            <button
              className="absolute top-3 right-3 text-white/60 hover:text-white cursor-pointer"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close"
            >
              <CloseIcon size={20} />
            </button>
            <h3 className="text-2xl md:text-3xl font-black text-white mb-4">{t.settingsTitle}</h3>

            <div className="space-y-5 text-white/80 text-sm md:text-base">
              <div>
                <div className="font-bold uppercase text-white/70 text-xs mb-1">{t.settingsAudio}</div>
                <div className="flex items-center gap-3">
                  <label className="text-white/70">{t.settingsVolume}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yellow-400"
                  />
                  <button
                    onClick={() => {
                      const isMuted = soundManager.toggleMute();
                      setMuted(isMuted);
                    }}
                    className="px-3 py-1 rounded-lg bg-white/10 border border-white/20 hover:bg-white/15 cursor-pointer"
                  >
                    {muted ? t.settingsUnmute : t.settingsMute}
                  </button>
                </div>
              </div>

              <div>
                <div className="font-bold uppercase text-white/70 text-xs mb-1">{t.settingsGraphics}</div>
                <div className="flex items-center gap-3">
                  <label className="text-white/70">{t.settingsQuality}</label>
                  <select
                    value={graphicsQuality}
                    onChange={(e) => {
                      const val = e.target.value === "low" ? "low" : "high";
                      setGraphicsQuality(val);
                      if (typeof localStorage !== "undefined") localStorage.setItem("nr-quality", val);
                    }}
                    className="bg-slate-900 text-white border border-white/20 rounded-lg px-3 py-2 focus:outline-none shadow-inner"
                  >
                    <option value="high">{t.settingsHigh}</option>
                    <option value="low">{t.settingsLow}</option>
                  </select>
                  <span className="text-white/50 text-xs">
                    {graphicsQuality === "high" ? "Default visuals" : "Lower effect load"}
                  </span>
                </div>
              </div>

              <div>
                <div className="font-bold uppercase text-white/70 text-xs mb-1">{t.settingsControls}</div>
                <div className="text-white/80 text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  {t.settingsKb}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tutorial Modal */}
      {tutorialOpen && (
        <div className="absolute inset-0 z-120 bg-black/70 backdrop-blur-md flex items-center justify-center">
          <div className="bg-white/10 border border-white/20 rounded-2xl p-6 md:p-8 w-[90%] max-w-xl shadow-2xl relative pointer-events-auto">
            <button
              className="absolute top-3 right-3 text-white/60 hover:text-white cursor-pointer"
              onClick={() => setTutorialOpen(false)}
              aria-label="Close tutorial"
            >
              <CloseIcon size={20} />
            </button>
            <h3 className="text-2xl md:text-3xl font-black text-white mb-4">{t.howtoTitle}</h3>
            <div className="space-y-3 text-white/80 text-sm md:text-base">
              <p>{t.howtoMovement}</p>
              <p>{t.howtoObjective}</p>
              <p>{t.howtoItems}</p>
              <p>{t.howtoOnline}</p>
            </div>
            <div className="mt-6 text-right">
              <button
                onClick={() => setTutorialOpen(false)}
                className="px-4 py-2 rounded-lg bg-white/15 text-white font-semibold hover:bg-white/25 border border-white/20 cursor-pointer"
              >
                {t.howtoClose}
              </button>
            </div>
          </div>
        </div>
      )}

      <Loader
        containerStyles={{ background: "#0ea5e9" }}
        innerStyles={{ width: "40vw", height: "10px", background: "rgba(255,255,255,0.2)", borderRadius: "5px" }}
        barStyles={{ height: "100%", background: "#fbbf24", borderRadius: "5px" }}
        dataInterpolation={(p: number) => `Loading Assets... ${p.toFixed(0)}%`}
        initialState={(active: boolean) => active}
      />
    </div>
  );
}
