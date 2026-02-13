"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { soundManager } from "@/lib/game/sound-manager";

interface EngineSoundProps {
    speedRef: React.RefObject<number>;
    maxSpeed?: number;
    enabled?: boolean;
}

export function EngineSound({ speedRef, maxSpeed = 45, enabled = true }: EngineSoundProps) {
    const started = useRef(false);

    useEffect(() => {
        if (!enabled) return;

        const ac = new AbortController();

        // Load sounds on first user interaction (browser autoplay policy)
        const initOnInteraction = () => {
            if (started.current) return;
            soundManager.load();
            soundManager.startEngine();
            started.current = true;
        };

        window.addEventListener("click", initOnInteraction, { signal: ac.signal });
        window.addEventListener("keydown", initOnInteraction, { signal: ac.signal });

        // Try immediately in case interaction already happened
        soundManager.load();
        soundManager.startEngine();
        started.current = true;

        return () => {
            ac.abort(); // Removes all listeners registered with this signal
            soundManager.stopEngine();
            started.current = false;
        };
    }, [enabled]);

    useFrame(() => {
        if (!enabled || !started.current) return;
        const speed = Math.abs(speedRef.current || 0);
        soundManager.updateEngine(speed, maxSpeed);
    });

    return null;
}
