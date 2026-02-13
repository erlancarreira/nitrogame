import React from "react";
import type { MapConfig } from "@/lib/game/maps";

interface StartGridProps {
    map: MapConfig;
}

export function StartGrid({ map }: StartGridProps) {
    return (
        <group>
            {/* Start Line - Single White Strip aligned with Arch */}
            <mesh
                position={[map.id === "green-valley" ? 0 : -5, 0.25, map.id === "green-valley" ? -250 : -20]}
                rotation={[-Math.PI / 2, 0, Math.PI / 2]}
            >
                {/* Width = trackWidth + 2.2 (Slightly wider to ensure it touches both pillars) */}
                <planeGeometry args={[map.trackWidth + 2.2 || 22.2, 1.0]} />
                <meshStandardMaterial color="white" />
            </mesh>
        </group>
    );
}
