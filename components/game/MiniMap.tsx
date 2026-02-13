"use client";

import React, { useMemo } from "react";
import type { MapConfig } from "@/lib/game/maps";
import { generateTrackPoints } from "@/lib/game/track-path";

interface MiniMapRacer {
  id: string;
  color: string;
  lapProgress: number;
  isPlayer: boolean;
  kartPosition?: [number, number, number];
  kartRotation?: number;
}

interface MiniMapProps {
  map: MapConfig;
  racers: MiniMapRacer[];
}

export const MiniMap = React.memo(function MiniMap({ map, racers }: MiniMapProps) {
  const player = racers.find((r) => r.isPlayer);
  const playerRotationRad = player?.kartRotation || 0;
  const playerRotationDeg = (playerRotationRad * 180) / Math.PI;

  // Gera caminho SVG a partir da geometria real da pista
  const { svgPath, worldToSvg } = useMemo(() => {
    const trackPoints = generateTrackPoints(map, 128);
    if (trackPoints.length < 2) {
      return {
        svgPath: "",
        worldToSvg: (_x: number, _z: number) => ({ x: 50, y: 50 }),
      };
    }

    let minX = Infinity,
      maxX = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    for (const [x, z] of trackPoints) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    const maxRange = Math.max(rangeX, rangeZ);
    const scale = 70 / maxRange;

    const toSvg = (wx: number, wz: number) => ({
      x: 50 + (wx - centerX) * scale,
      y: 50 - (wz - centerZ) * scale,
    });

    const parts = trackPoints.map(([x, z], i) => {
      const { x: sx, y: sy } = toSvg(x, z);
      return `${i === 0 ? "M" : "L"} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
    });
    parts.push("Z");

    return { svgPath: parts.join(" "), worldToSvg: toSvg };
  }, [map]);

  const mapRotation = -playerRotationDeg;

  return (
    <div className="w-full h-full relative flex items-center justify-center overflow-hidden rounded-2xl">
      <svg
        viewBox="0 0 100 100"
        className="w-[140%] h-[140%] drop-shadow-md overflow-visible transition-transform duration-100 ease-linear"
        style={{ transform: `rotate(${mapRotation}deg)` }}
      >
        {/* Sombra da pista */}
        <path
          d={svgPath}
          fill="none"
          stroke="black"
          strokeWidth="9"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.4"
        />

        {/* Pista — borda externa */}
        <path
          d={svgPath}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="7"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Pista — asfalto interno */}
        <path
          d={svgPath}
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="4.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Corredores posicionados pelas coordenadas reais do mundo */}
        {racers.map((racer) => {
          const pos = racer.kartPosition
            ? worldToSvg(racer.kartPosition[0], racer.kartPosition[2])
            : { x: 50, y: 50 };

          return (
            <g key={racer.id} transform={`translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`}>
              {racer.isPlayer ? (
                <g transform={`rotate(${playerRotationDeg})`}>
                  <circle r="7" fill={racer.color} opacity="0.3" />
                  <circle r="4.5" fill={racer.color} stroke="white" strokeWidth="2" />
                  <path d="M 0 -6.5 L -3.5 1.5 L 3.5 1.5 Z" fill="white" />
                </g>
              ) : (
                <>
                  <circle r="3.5" fill={racer.color} stroke="white" strokeWidth="1.5" />
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
});
