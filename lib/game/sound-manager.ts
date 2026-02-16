import { Howl, Howler } from "howler";

// ── Sound file paths ─────────────────────────────────────────────────
const SFX_BASE = "/assets/sounds/sfx";

const SOUND_PATHS = {
  engine: `${SFX_BASE}/Go-Kart-Sound-Effects-2_Engine-revving.ogg`,
  drift: `${SFX_BASE}/drift.ogg`,
  item_collect: `${SFX_BASE}/item_collect.ogg`,
  boost: `${SFX_BASE}/boost.ogg`,
  banana_hit: `${SFX_BASE}/banana_hit.ogg`,
  hit: `${SFX_BASE}/hit.ogg`,
  spin_out: `${SFX_BASE}/spin_out.ogg`,
  countdown_beep: `${SFX_BASE}/countdown_beep.ogg`,
  countdown_go: `${SFX_BASE}/countdown_go.ogg`,
  lap_complete: `${SFX_BASE}/lap_complete.ogg`,
  race_finish: `${SFX_BASE}/race_finish.ogg`,
  victory: `${SFX_BASE}/victory.ogg`,
  ui_click: `${SFX_BASE}/ui_click.ogg`,
  ui_hover: `${SFX_BASE}/ui_hover.ogg`,
  intro_music: "/assets/sounds/musics/music_intro.mp3",
  intro_music_2: "/assets/sounds/musics/music_intro_2.mp3",
  intro_music_3: "/assets/sounds/musics/music_intro_3.mp3",
} as const;

export type SoundName = keyof typeof SOUND_PATHS;

// ── Engine tuning (player's own kart) ─────────────────────────────────
// Volume must be high enough to stay dominant over spatial rivals at all distances.
// Previous values (0.10/0.30) made the player engine feel "weak" when far from rivals
// because the combined spatial engines nearby inflated the perceived loudness.
const ENGINE_MIN_RATE = 0.5;   // playback rate at speed=0
const ENGINE_MAX_RATE = 1.8;   // playback rate at maxSpeed
const ENGINE_IDLE_VOL = 0.18;  // volume when stationary (was 0.10 — too quiet)
const ENGINE_MAX_VOL = 0.50;   // volume at full speed  (was 0.30 — drowned by rivals)

// ── Spatial engine tuning (rival karts — distance-based) ─────────────
const SPATIAL_MAX_DISTANCE = 150;   // Beyond this, rival engine is silent (meters)
const SPATIAL_MIN_DISTANCE = 3;     // Within this, rival engine is at max volume
const SPATIAL_MAX_VOL = 0.14;       // Max volume for a rival kart right next to you (was 0.18 — too loud vs player)
const SPATIAL_MIN_RATE = 0.45;      // Pitch at speed=0 (slightly different from player for variety)
const SPATIAL_MAX_RATE = 1.7;       // Pitch at maxSpeed
const SPATIAL_RATE_JITTER = 0.05;   // Per-kart pitch offset (each kart sounds slightly different)
const SPATIAL_PAN_STRENGTH = 0.8;   // Stereo pan intensity (-1 left, +1 right)
const MAX_SPATIAL_ENGINES = 7;      // Max simultaneous rival engine sounds

// ── Drift tuning ────────────────────────────────────────────────────
const DRIFT_VOL = 0.2;
const DRIFT_FADE_IN = 150;     // ms
const DRIFT_FADE_OUT = 200;    // ms

// ── Spatial Engine Slot (one per rival kart) ─────────────────────────
interface SpatialEngineSlot {
  kartId: string;
  howl: Howl;
  playId: number | null;
  playing: boolean;
  lastRate: number;
  lastVol: number;
  lastPan: number;
  pitchOffset: number;  // Per-kart random jitter so each kart sounds unique
}

// ── SoundManager Singleton ──────────────────────────────────────────
class SoundManager {
  private sounds: Partial<Record<SoundName, Howl>> = {};
  private _loaded = false;
  private _muted = false;
  private _masterVolume = 0.7;

  // Engine state (player's own kart)
  private _engineId: number | null = null;
  private _enginePlaying = false;
  private _lastRate = 0;
  private _lastVol = 0;

  // Spatial engines (rival karts — object pool)
  private _spatialEngines: Map<string, SpatialEngineSlot> = new Map();
  private _spatialHowlPool: Howl[] = [];  // Reusable Howl instances

  // Drift state
  private _driftId: number | null = null;
  private _driftPlaying = false;

  // Intro state
  private _currentIntroTrack: SoundName | null = null;

  /** Preload critical sounds. Call once after first user interaction. */
  load(): void {
    if (this._loaded) return;
    this._loaded = true;

    // Engine — looping (critical, preload immediately)
    this.sounds.engine = new Howl({
      src: [SOUND_PATHS.engine],
      loop: true,
      volume: 0,
      preload: true,
    });

    // Drift — looping
    this.sounds.drift = new Howl({
      src: [SOUND_PATHS.drift],
      loop: true,
      volume: 0,
      preload: true,
    });

    // SFX: lazy-load on first play (avoids blocking main thread with 7 Howl creations)
    // Sounds will be created in _getOrCreateSfx() on demand.

    Howler.volume(this._masterVolume);
  }

  /** Get or lazy-create a one-shot SFX Howl */
  private _getOrCreateSfx(name: SoundName): Howl {
    if (!this.sounds[name]) {
      this.sounds[name] = new Howl({
        src: [SOUND_PATHS[name]],
        volume: 0.5,
        preload: true,
      });
    }
    return this.sounds[name]!;
  }

  get masterVolume(): number {
    return this._masterVolume;
  }

  // ── Intro Music ────────────────────────────────────────────────────

  playIntroMusic(): void {
    const introTracks: SoundName[] = ["intro_music_2", "intro_music_3"];

    // Resume context if suspended (browser policy attempt)
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume();
    }

    // Check if we are already playing a valid intro track
    if (this._currentIntroTrack && this.sounds[this._currentIntroTrack]?.playing()) {
      return;
    }

    // Stop any stragglers just in case (e.g. from hot reload or weird state)
    this.stopIntroMusic();

    // Pick a random track
    const randomTrack = introTracks[Math.floor(Math.random() * introTracks.length)];
    this._currentIntroTrack = randomTrack;

    if (!this.sounds[randomTrack]) {
      this.sounds[randomTrack] = new Howl({
        src: [SOUND_PATHS[randomTrack]],
        loop: true,
        volume: 0.5,
        preload: true,
        html5: false,
        autoplay: true,
      });
    }

    if (!this.sounds[randomTrack]?.playing()) {
      this.sounds[randomTrack]?.play();
    }
  }

  stopIntroMusic(): void {
    const introTracks: SoundName[] = ["intro_music", "intro_music_2", "intro_music_3"];
    introTracks.forEach(track => {
      this.sounds[track]?.stop();
    });
    this._currentIntroTrack = null;
  }

  // ── Engine ─────────────────────────────────────────────────────────

  /** Start the engine loop. Usually called when race starts. */
  startEngine(): void {
    if (!this.sounds.engine || this._enginePlaying) return;
    this._engineId = this.sounds.engine.play();
    this.sounds.engine.volume(ENGINE_IDLE_VOL, this._engineId);
    this.sounds.engine.rate(ENGINE_MIN_RATE, this._engineId);
    this._enginePlaying = true;
  }

  /** Stop the engine loop with a fade-out to avoid abrupt cutoff. */
  stopEngine(fadeMs: number = 800): void {
    if (!this.sounds.engine || !this._enginePlaying) return;
    const id = this._engineId;
    if (id !== null && fadeMs > 0) {
      this.sounds.engine.fade(this._lastVol || ENGINE_IDLE_VOL, 0, fadeMs, id);
      setTimeout(() => {
        this.sounds.engine?.stop(id);
      }, fadeMs + 50);
    } else {
      this.sounds.engine.stop(id ?? undefined);
    }
    this._enginePlaying = false;
    this._engineId = null;
  }

  /** Update engine pitch and volume based on current speed. Call every frame.
   *  Only touches Howler when values change significantly (avoids 60 API calls/s). */
  updateEngine(speed: number, maxSpeed: number): void {
    if (!this.sounds.engine || this._engineId === null) return;

    const t = Math.min(Math.abs(speed) / maxSpeed, 1);

    // Rate (pitch) — slight ease-in curve for more natural RPM feel
    // sqrt makes low speeds already sound more responsive (revving up faster)
    const tPitch = Math.sqrt(t);
    const rate = ENGINE_MIN_RATE + tPitch * (ENGINE_MAX_RATE - ENGINE_MIN_RATE);
    if (Math.abs(rate - this._lastRate) > 0.01) {
      this._lastRate = rate;
      this.sounds.engine.rate(rate, this._engineId);
    }

    // Volume — ease-in curve so engine quickly reaches audible level
    // Without this, first 30% of speed range barely changes volume
    const tVol = Math.sqrt(t);
    const vol = ENGINE_IDLE_VOL + tVol * (ENGINE_MAX_VOL - ENGINE_IDLE_VOL);
    if (Math.abs(vol - this._lastVol) > 0.005) {
      this._lastVol = vol;
      this.sounds.engine.volume(vol, this._engineId);
    }
  }

  // ── Spatial Engines (rival karts — professional multi-kart audio) ──
  // Technique: Each rival kart gets its own Howl instance with independent
  // pitch, volume, and stereo pan based on distance/angle to the player.
  // Like Forza/GT/Mario Kart — you hear each rival engine individually,
  // getting louder as they approach and panning left/right as they pass.

  /** Get or create a Howl from the pool for a spatial engine */
  private _acquireSpatialHowl(): Howl {
    const pooled = this._spatialHowlPool.pop();
    if (pooled) return pooled;

    return new Howl({
      src: [SOUND_PATHS.engine],
      loop: true,
      volume: 0,
      preload: true,
    });
  }

  /** Return a Howl to the pool (stop it first) */
  private _releaseSpatialHowl(howl: Howl): void {
    howl.stop();
    howl.volume(0);
    this._spatialHowlPool.push(howl);
  }

  /**
   * Register a rival kart for spatial engine audio.
   * Call once when a bot/remote kart enters the scene.
   */
  startSpatialEngine(kartId: string): void {
    if (this._spatialEngines.has(kartId)) return;
    if (this._spatialEngines.size >= MAX_SPATIAL_ENGINES) return;

    const howl = this._acquireSpatialHowl();
    const playId = howl.play();
    howl.volume(0, playId);
    howl.rate(SPATIAL_MIN_RATE, playId);

    // Random pitch offset so each kart has a slightly different engine tone
    const pitchOffset = (Math.random() - 0.5) * 2 * SPATIAL_RATE_JITTER;

    this._spatialEngines.set(kartId, {
      kartId,
      howl,
      playId,
      playing: true,
      lastRate: 0,
      lastVol: 0,
      lastPan: 0,
      pitchOffset,
    });
  }

  /**
   * Remove a rival kart's engine sound (when it leaves the scene).
   */
  stopSpatialEngine(kartId: string, fadeMs: number = 400): void {
    const slot = this._spatialEngines.get(kartId);
    if (!slot) return;

    if (slot.playId !== null && fadeMs > 0) {
      slot.howl.fade(slot.lastVol, 0, fadeMs, slot.playId);
      setTimeout(() => {
        this._releaseSpatialHowl(slot.howl);
      }, fadeMs + 50);
    } else {
      this._releaseSpatialHowl(slot.howl);
    }
    this._spatialEngines.delete(kartId);
  }

  /**
   * Update a rival kart's engine based on its spatial relationship to the player.
   * Call every frame from a useFrame hook.
   *
   * @param kartId - The rival kart ID
   * @param distance - Distance from player to rival (meters)
   * @param pan - Stereo pan value (-1 = left, 0 = center, +1 = right)
   * @param rivalSpeed - The rival kart's current speed
   * @param rivalMaxSpeed - The rival kart's max speed
   */
  updateSpatialEngine(
    kartId: string,
    distance: number,
    pan: number,
    rivalSpeed: number,
    rivalMaxSpeed: number
  ): void {
    const slot = this._spatialEngines.get(kartId);
    if (!slot || slot.playId === null) return;

    // Volume: inverse distance falloff (quadratic for natural attenuation)
    // Clamped between min/max distance
    let vol = 0;
    if (distance < SPATIAL_MAX_DISTANCE) {
      const normalizedDist = Math.max(0, (distance - SPATIAL_MIN_DISTANCE) / (SPATIAL_MAX_DISTANCE - SPATIAL_MIN_DISTANCE));
      // Quadratic falloff (more natural than linear — like real sound)
      vol = SPATIAL_MAX_VOL * (1 - normalizedDist) * (1 - normalizedDist);
      // Speed also affects volume (idle kart is quieter)
      const speedFactor = 0.3 + 0.7 * Math.min(Math.abs(rivalSpeed) / Math.max(rivalMaxSpeed, 1), 1);
      vol *= speedFactor;
    }

    // Pitch: based on rival's speed + unique per-kart offset
    const speedT = Math.min(Math.abs(rivalSpeed) / Math.max(rivalMaxSpeed, 1), 1);
    const rate = SPATIAL_MIN_RATE + speedT * (SPATIAL_MAX_RATE - SPATIAL_MIN_RATE) + slot.pitchOffset;

    // Stereo pan: clamped and scaled
    const clampedPan = Math.max(-1, Math.min(1, pan * SPATIAL_PAN_STRENGTH));

    // Only update Howler when values change significantly (performance)
    if (Math.abs(vol - slot.lastVol) > 0.003) {
      slot.lastVol = vol;
      slot.howl.volume(Math.max(0, vol), slot.playId);
    }
    if (Math.abs(rate - slot.lastRate) > 0.01) {
      slot.lastRate = rate;
      slot.howl.rate(Math.max(0.1, rate), slot.playId);
    }
    if (Math.abs(clampedPan - slot.lastPan) > 0.02) {
      slot.lastPan = clampedPan;
      slot.howl.stereo(clampedPan, slot.playId);
    }
  }

  /** Stop all spatial engines (e.g. race finished or leaving game). */
  stopAllSpatialEngines(fadeMs: number = 800): void {
    for (const [kartId] of this._spatialEngines) {
      this.stopSpatialEngine(kartId, fadeMs);
    }
  }

  /** Check if a spatial engine is registered for a kart */
  hasSpatialEngine(kartId: string): boolean {
    return this._spatialEngines.has(kartId);
  }

  // ── Drift ──────────────────────────────────────────────────────────

  /** Start or stop drift sound based on drift state. */
  setDrifting(isDrifting: boolean): void {
    if (!this.sounds.drift) return;

    if (isDrifting && !this._driftPlaying) {
      this._driftId = this.sounds.drift.play();
      this.sounds.drift.fade(0, DRIFT_VOL, DRIFT_FADE_IN, this._driftId);
      this._driftPlaying = true;
    } else if (!isDrifting && this._driftPlaying) {
      if (this._driftId !== null) {
        const id = this._driftId;
        this.sounds.drift.fade(DRIFT_VOL, 0, DRIFT_FADE_OUT, id);
        setTimeout(() => {
          this.sounds.drift?.stop(id);
        }, DRIFT_FADE_OUT + 50);
      }
      this._driftPlaying = false;
      this._driftId = null;
    }
  }

  // ── One-shot SFX ───────────────────────────────────────────────────

  /** Play a one-shot sound effect (lazy-loads on first use). */
  play(name: SoundName, volume?: number): void {
    const howl = this._getOrCreateSfx(name);
    const id = howl.play();
    if (volume !== undefined) {
      howl.volume(volume, id);
    }
  }

  // ── Global Controls ────────────────────────────────────────────────

  get muted(): boolean { return this._muted; }

  toggleMute(): boolean {
    this._muted = !this._muted;
    Howler.mute(this._muted);
    return this._muted;
  }

  setMasterVolume(vol: number): void {
    this._masterVolume = Math.max(0, Math.min(1, vol));
    Howler.volume(this._masterVolume);
  }

  /** Clean up all sounds. Call when leaving the game. */
  dispose(): void {
    this.stopEngine();
    this.stopAllSpatialEngines(0);
    this.setDrifting(false);
    // Unload pooled spatial Howls
    for (const howl of this._spatialHowlPool) {
      howl.unload();
    }
    this._spatialHowlPool = [];
    for (const howl of Object.values(this.sounds)) {
      howl?.unload();
    }
    this.sounds = {};
    this._loaded = false;
  }
}

// Singleton export
export const soundManager = new SoundManager();
