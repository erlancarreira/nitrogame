"use client";

import { forwardRef, useImperativeHandle } from "react";
import { soundManager } from "@/lib/game/sound-manager";

export interface SoundEffectsRef {
    play: (type: "item_collect" | "banana_hit" | "boost" | "spin_out") => void;
}

export const SoundEffects = forwardRef<SoundEffectsRef, { enabled?: boolean }>(function SoundEffects({ enabled = true }, ref) {
    useImperativeHandle(ref, () => ({
        play: (type) => {
            if (!enabled) return;
            soundManager.load(); // no-op if already loaded
            soundManager.play(type);
        },
    }));

    return null;
});
