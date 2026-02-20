// Outros sistemas de pista foram removidos junto com os mapas que os usavam.
// Se precisar reintroduzi-los no futuro, re-importe PlacedTile/generateFromTemplate aqui.

export interface MapConfig {
  id: string;
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard" | "expert";
  trackColor: string;
  grassColor: string;
  barrierColors: [string, string];
  skyPreset: "sunset" | "dawn" | "night" | "day";
  trackType: "oval" | "circuit" | "figure8" | "complex";
  // Optional custom path points (x, z) for real-world track layouts.
  pathPoints?: [number, number][];
  trackWidth: number;
  trackLength: number;
  curveRadius: number;
  decorationType: "forest" | "desert" | "snow" | "city";
  textureUrl?: string;
  textureScale?: number;
  textureCrop?: number;
  thumbnail: string;
  startPositions: [number, number, number][];
  startRotation?: number;
  modelUrl?: string;
  modelScale?: number;
  itemBoxPositions?: [number, number, number][];

  // Sistema modular de pista (opcional)
  trackSystem?: {
    type: 'legacy' | 'spline' | 'model';
    modelUrl?: string;
    modelScale?: number;
  };
}

export const MAPS: MapConfig[] = [
  {
    id: "green-valley",
    name: "Green Valley",
    description: "A scenic oval track through lush meadows",
    difficulty: "easy",
    trackColor: "#333333",
    grassColor: "#4a7c23",
    barrierColors: ["#ff4444", "#4444ff"],
    skyPreset: "day",
    trackType: "oval",
    trackWidth: 30,
    trackLength: 500,
    curveRadius: 180,
    decorationType: "forest",
    textureUrl: "/assets/kart-map/green-valley/track_straight_one_lane.png",
    textureScale: 0.2,
    textureCrop: 0.10,
    thumbnail: "green",
    startPositions: [
      [6, 1, -245],
      [6, 1, -255],
      [16, 1, -245],
      [16, 1, -255],
      [26, 1, -245],
      [26, 1, -255],
      [36, 1, -245],
      [36, 1, -255],
    ],
    startRotation: -Math.PI / 2,
  },
];

export function getMapById(id: string): MapConfig | undefined {
  return MAPS.find((map) => map.id === id);
}
