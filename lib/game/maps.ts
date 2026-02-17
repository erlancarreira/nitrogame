import { PlacedTile, generateFromTemplate } from "./track";
import { CIRCUIT_TECHNICAL } from "./track/templates";

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
  textureUrl?: string; // Caminho para textura base da pista
  textureScale?: number; // Escala de repetição da textura (default: 0.1)
  textureCrop?: number; // Corte lateral da textura (0 a 0.5) para remover margens
  thumbnail: string;
  startPositions: [number, number, number][];
  startRotation?: number; // Optional: Explicit start rotation in radians (overrides auto-calculation)
  modelUrl?: string;
  modelScale?: number;
  itemBoxPositions?: [number, number, number][];

  // Novo sistema (opcional, para não quebrar)
  // Novo sistema (modular)
  trackSystem?: {
    type: 'legacy' | 'spline-tiles' | 'spline' | 'tile-kit' | 'model'; // Expanded types

    // Para spline-tiles:
    seed?: string;
    tiles?: PlacedTile[]; // Tiles pré-gerados (opcional)

    // Para tile-kit:
    kit?: 'racing-kit' | 'future-kit';
    layout?: 'circuit' | 'oval' | 'figure8' | 'custom';

    // Para model:
    modelUrl?: string;
    modelScale?: number;

    difficulty?: 'easy' | 'medium' | 'hard' | 'expert';
    features?: {
      terrain: boolean;
      floating: boolean; // Se true, sem terreno embaixo (tipo Rainbow Road)
    };
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
    trackWidth: 30,        // Pista bem larga (aumentado de 24 para 30)
    trackLength: 500,      // Pista mais longa (aumentado de 400 para 500)
    curveRadius: 180,      // Curvas amplas (aumentado de 120 para 180)
    decorationType: "forest",
    textureUrl: "/assets/kart-map/green-valley/track_straight_one_lane.png",
    textureScale: 0.2,     // Aumentar repetição para melhorar nitidez (5m por repetição)
    textureCrop: 0.10,     // Corte moderado para remover margens sem muito zoom
    thumbnail: "green",
    startPositions: [
      // Track tangent at start is -X (West). Lateral is Z. Center Z is -250.
      // Row 1 (Front): X=6. (Shifted back +6m from 0 to be behind line)
      // Row 2 (Back): X=16.
      // Lane 1 (Left): Z=-245. Lane 2 (Right): Z=-255. (Assuming facing -X).
      [6, 1, -245],      // P1 (Row 1, Left)
      [6, 1, -255],      // P2 (Row 1, Right)
      [16, 1, -245],     // P3 (Row 2, Left)
      [16, 1, -255],     // P4 (Row 2, Right)
      [26, 1, -245],     // P5 (Row 3, Left)
      [26, 1, -255],     // P6 (Row 3, Right)
      [36, 1, -245],     // P7 (Row 4, Left)
      [36, 1, -255],     // P8 (Row 4, Right)
    ],
    startRotation: -Math.PI / 2, // Face West aligned with track direction
    // itemBoxPositions removed — auto-generated via generateItemBoxPositions()
    // which projects onto the actual track spline (guaranteed on pavement)
  },
  {
    id: "sunset-circuit",
    name: "Sunset Circuit",
    description: "A challenging figure-8 track at golden hour",
    difficulty: "medium",
    trackColor: "#2a2a2a",
    grassColor: "#c4a35a",
    barrierColors: ["#ff8800", "#ffcc00"],
    skyPreset: "sunset",
    trackType: "figure8",
    trackWidth: 14,
    trackLength: 300,
    curveRadius: 90,
    decorationType: "desert",
    thumbnail: "orange",
    startPositions: [
      [-75, 1, -3],
      [-75, 1, 3],
      [-80, 1, -3],
      [-80, 1, 3],
      [-85, 1, -3],
      [-85, 1, 3],
      [-90, 1, -3],
      [-90, 1, 3],
    ],
  },
  {
    id: "frost-peak",
    name: "Frost Peak",
    description: "An icy mountain circuit with tight corners",
    difficulty: "hard",
    trackColor: "#4a5568",
    grassColor: "#e8f4f8",
    barrierColors: ["#00ccff", "#ffffff"],
    skyPreset: "dawn",
    trackType: "circuit",
    trackWidth: 13,
    trackLength: 320,
    curveRadius: 90,
    decorationType: "snow",
    thumbnail: "blue",
    startPositions: [
      [87, 1, -85],
      [93, 1, -85],
      [87, 1, -90],
      [93, 1, -90],
      [87, 1, -95],
      [93, 1, -95],
      [87, 1, -100],
      [93, 1, -100],
    ],
  },
  {
    id: "neon-nights",
    name: "Neon Nights",
    description: "A futuristic city track with complex turns",
    difficulty: "expert",
    trackColor: "#1a1a2e",
    grassColor: "#16213e",
    barrierColors: ["#ff00ff", "#00ffff"],
    skyPreset: "night",
    trackType: "complex",
    trackWidth: 12,
    trackLength: 360,
    curveRadius: 100,
    decorationType: "city",
    thumbnail: "purple",
    startPositions: [
      [-3, 1, -185],
      [3, 1, -185],
      [-3, 1, -190],
      [3, 1, -190],
      [-3, 1, -195],
      [3, 1, -195],
      [-3, 1, -200],
      [3, 1, -200],
    ],
  },
  {
    id: "volcano-rush",
    name: "Volcano Rush",
    description: "A scorching circuit through volcanic terrain",
    difficulty: "medium",
    trackColor: "#2a1a1a",
    grassColor: "#8b4513",
    barrierColors: ["#ff4500", "#ff8c00"],
    skyPreset: "sunset",
    trackType: "circuit",
    trackWidth: 15,
    trackLength: 340,
    curveRadius: 100,
    decorationType: "desert",
    thumbnail: "red",
    startPositions: [
      [0, 1, -170],
      [6, 1, -170],
      [0, 1, -175],
      [6, 1, -175],
      [0, 1, -180],
      [6, 1, -180],
      [0, 1, -185],
      [6, 1, -185],
    ],
  },
  {
    id: "crystal-caves",
    name: "Crystal Caves",
    description: "Navigate through icy caverns with sharp turns",
    difficulty: "hard",
    trackColor: "#2c3e50",
    grassColor: "#d4e6f1",
    barrierColors: ["#3498db", "#9b59b6"],
    skyPreset: "dawn",
    trackType: "complex",
    trackWidth: 13,
    trackLength: 350,
    curveRadius: 85,
    decorationType: "snow",
    thumbnail: "cyan",
    startPositions: [
      [-2, 1, -175],
      [4, 1, -175],
      [-2, 1, -180],
      [4, 1, -180],
      [-2, 1, -185],
      [4, 1, -185],
      [-2, 1, -190],
      [4, 1, -190],
    ],
  },
  {
    id: "cyber-loop",
    name: "Cyber Loop",
    description: "A high-speed neon circuit with tight chicanes",
    difficulty: "expert",
    trackColor: "#0f0f23",
    grassColor: "#1a1a2e",
    barrierColors: ["#00ff41", "#ff006e"],
    skyPreset: "night",
    trackType: "circuit",
    trackWidth: 11,
    trackLength: 380,
    curveRadius: 95,
    decorationType: "city",
    thumbnail: "green",
    startPositions: [
      [-1, 1, -190],
      [5, 1, -190],
      [-1, 1, -195],
      [5, 1, -195],
      [-1, 1, -200],
      [5, 1, -200],
      [-1, 1, -205],
      [5, 1, -205],
    ],
  },
  {
    id: "turbo-speedway",
    name: "Turbo Speedway",
    description: "A professional circuit with sweeping curves and chicanes",
    difficulty: "medium",
    trackColor: "#3a3a3a",
    grassColor: "#3d7a1e",
    barrierColors: ["#ff2222", "#ffffff"],
    skyPreset: "day",
    trackType: "circuit",
    trackWidth: 20,
    trackLength: 400,
    curveRadius: 120,
    decorationType: "forest",
    thumbnail: "red",
    // Grid-based circuit (TILE_SIZE=20). Path follows center of road tiles.
    // Circuit: start(+X) → turn1(BR) → straight(-Z) → turn2(TR) →
    //          straight(-X) → turn3(TL) → straight(+Z) → turn4(BL) → start
    // pathPoints: [
    //   // Start/finish straight (+X direction, z center = -10)
    //   [0, -10],
    //   [20, -10],
    //   [40, -10],
    //   [60, -10],
    //   [80, -10],
    //   // Turn 1 — bottom-right (large 2x2 corner)
    //   [100, -15],
    //   [115, -30],
    //   [120, -45],
    //   // Right straight (-Z direction, x center = 130)
    //   [130, -70],
    //   [130, -100],
    //   [130, -120],
    //   [130, -150],
    //   [130, -170],
    //   // Turn 2 — top-right (larger 3x3 corner)
    //   [120, -190],
    //   [100, -200],
    //   [80, -200],
    //   // Top straight (-X direction, z center = -190)
    //   [50, -190],
    //   [20, -190],
    //   [0, -190],
    //   [-20, -190],
    //   // Turn 3 — top-left (larger 3x3 corner)
    //   [-50, -195],
    //   [-70, -185],
    //   [-80, -170],
    //   // Left straight (+Z direction, x center = -80)
    //   [-80, -140],
    //   [-80, -110],
    //   [-80, -80],
    //   [-80, -50],
    //   // Turn 4 — bottom-left (large 2x2 corner)
    //   [-75, -25],
    //   [-60, -12],
    //   [-40, -10],
    //   [-20, -10],
    // ],
    startPositions: [
      // Start at gx 0..1 area, facing +X
      [5, 1, -5],
      [5, 1, -15],
      [15, 1, -5],
      [15, 1, -15],
      [25, 1, -5],
      [25, 1, -15],
      [35, 1, -5],
      [35, 1, -15],
    ],
    startRotation: 0, // Facing +X
  },
  {
    id: "rainbow-road-pro",
    name: "Rainbow Road Pro",
    description: "A procedurally generated masterpiece using the new spline system",
    difficulty: "expert",
    trackColor: "#222222", // Multicolor handling will be in the renderer
    grassColor: "#000000", // Space
    barrierColors: ["#ff00ff", "#00ffff"],
    skyPreset: "night",
    trackType: "complex",
    trackWidth: 16,
    trackLength: 1000, // Procedural, so this is ensuring camera far clip is ok
    curveRadius: 100,
    decorationType: "city",
    thumbnail: "purple",
    startPositions: [
      [0, 2, 0], [5, 2, 0], [-5, 2, 0], [10, 2, 0],
      [-10, 2, 0], [15, 2, 0], [-15, 2, 0], [20, 2, 0]
    ],
    // Activates the new system
    trackSystem: {
      type: 'spline-tiles',
      seed: 'rainbow-road-v1',
      features: {
        terrain: false, // Space!
        floating: true
      }
    }
  },
  {
    id: "generated-technical",
    name: "Generated Technical",
    description: "A technical circuit generated from grammar template",
    difficulty: "hard",
    trackColor: "#444444",
    grassColor: "#2d5a27",
    barrierColors: ["#ffff00", "#333333"],
    skyPreset: "day",
    trackType: "complex",
    trackWidth: 40,
    trackLength: 1200,
    curveRadius: 80,
    decorationType: "forest",
    thumbnail: "green",
    startPositions: [
      [0, 2, 0], [5, 2, 0], [-5, 2, 0], [10, 2, 0] // Placeholder
    ],
    trackSystem: {
      type: 'spline-tiles',
      tiles: generateFromTemplate(CIRCUIT_TECHNICAL, 'seed-123'),
      features: {
        terrain: true,
        floating: false
      }
    }
  }
];

export function getMapById(id: string): MapConfig | undefined {
  return MAPS.find((map) => map.id === id);
}
