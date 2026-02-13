"use client";

import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { soundManager } from "@/lib/game/sound-manager";

interface DriftSoundProps {
    enabled?: boolean;
    isDrifting?: boolean;
    isDriftingRef?: React.RefObject<boolean>;
}

export function DriftSound({ enabled = true, isDrifting = false, isDriftingRef }: DriftSoundProps) {
    const wasDrifting = useRef(false);

    // When disabled or unmounted, force-stop drift sound to prevent stuck audio
    useEffect(() => {
        if (!enabled && wasDrifting.current) {
            wasDrifting.current = false;
            soundManager.setDrifting(false);
        }
        return () => {
            if (wasDrifting.current) {
                wasDrifting.current = false;
                soundManager.setDrifting(false);
            }
        };
    }, [enabled]);

    useFrame(() => {
        if (!enabled) return;

        const drifting = isDriftingRef?.current ?? isDrifting;

        // Only call setDrifting on state change (avoid calling every frame)
        if (drifting !== wasDrifting.current) {
            wasDrifting.current = drifting;
            soundManager.setDrifting(drifting);
        }
    });

    return null;
}
