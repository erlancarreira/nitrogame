import { TileType, TileConfig, PlacedTile } from "./tile";
import * as THREE from "three";

export type GrammarSymbol =
    | 'S'   // Start
    | 'F'   // Forward (straight)
    | 'L'   // Left turn
    | 'R'   // Right turn
    | 'U'   // U-turn
    | '['   // Save state (branching - not fully supported yet but good for future)
    | ']'   // Restore state
    | 'A'   // Decoration A
    | 'B'   // Decoration B
    | 'C'   // Checkpoint
    | 'E';  // End / Finish Line

export interface GrammarRule {
    symbol: GrammarSymbol;
    replacements: { symbols: GrammarSymbol[], probability: number }[];
}

export interface TrackTemplate {
    name: string;
    axiom: GrammarSymbol[]; // Initial string
    rules: GrammarRule[];
    iterations: number;
    constraints: {
        minLength: number;
        maxLength: number;
        forceLoop: boolean;
    };
}

// Simple L-System expander
export function expandGrammar(template: TrackTemplate, seed: number): GrammarSymbol[] {
    let currentString = [...template.axiom];

    // Simple PRNG
    let localSeed = seed;
    const random = () => {
        localSeed = (localSeed * 9301 + 49297) % 233280;
        return localSeed / 233280;
    };

    for (let i = 0; i < template.iterations; i++) {
        const nextString: GrammarSymbol[] = [];

        for (const symbol of currentString) {
            const rule = template.rules.find(r => r.symbol === symbol);

            if (rule) {
                // Select replacement based on probability
                const r = random();
                let cumulative = 0;
                let selected = rule.replacements[0].symbols; // fallback

                for (const replacement of rule.replacements) {
                    cumulative += replacement.probability;
                    if (r <= cumulative) {
                        selected = replacement.symbols;
                        break;
                    }
                }
                nextString.push(...selected);
            } else {
                nextString.push(symbol);
            }
        }
        currentString = nextString;
    }

    return currentString;
}

/**
 * Converts a sequence of symbols into PlacedTiles.
 * This effectively "turtles" through the world, placing tiles.
 * 
 * Note: Closing loops perfectly is HARD in procedural generation.
 * For this implementation, we will generate a path and if forceLoop is true,
 * we might need a post-processing step to connect End to Start, 
 * or just rely on the grammar being designed to loop (e.g. 4 Right turns).
 */
export function interpretGrammar(
    symbols: GrammarSymbol[],
    startConfig: { width: number },
    seed: number
): TileConfig[] {

    return symbols.map(symbol => {
        // Map symbols to TileConfigs
        // This is a simplified mapping. Real system would allow variation in params.
        const baseConfig: TileConfig = {
            type: 'straight',
            width: startConfig.width,
            length: 20,
            elevation: 0,
            bankAngle: 0,
            surface: 'asphalt',
            barriers: 'concrete',
            decorations: 'none'
        };

        switch (symbol) {
            case 'S': return { ...baseConfig, type: 'start_line', length: 10 };
            case 'F': return { ...baseConfig, type: 'straight', length: 40 };
            case 'L': return { ...baseConfig, type: 'curve_left', length: 60, bankAngle: 15 };
            case 'R': return { ...baseConfig, type: 'curve_right', length: 60, bankAngle: -15 };
            case 'U': return { ...baseConfig, type: 'hairpin_right', length: 80, bankAngle: -20 };
            case 'E': return { ...baseConfig, type: 'finish_line', length: 10 };
            default: return baseConfig; // Fallback
        }
    });
}

export const TEMPLATE_RAINBOW: TrackTemplate = {
    name: "Rainbow Loop",
    axiom: ['S', 'F', 'F', 'L', 'F', 'R', 'F', 'L', 'U', 'F', 'R', 'F', 'L', 'F', 'E'],
    rules: [], // Simple static for now to guarantee loop visually
    iterations: 1,
    constraints: { minLength: 10, maxLength: 50, forceLoop: false }
};

export function generateFromTemplate(
    template: TrackTemplate,
    seed: string,
    overrides?: Partial<TrackTemplate['constraints']>
): PlacedTile[] {
    // 1. Expand grammar
    // Simple string hash for number seed
    const numSeed = seed.split('').reduce((a, b) => a + b.charCodeAt(0), 0);

    // Expand
    const symbols = expandGrammar(template, numSeed);

    // 2. Convert to configs
    // Default width 20 for now, can be overridden if passed in templates
    const configs = interpretGrammar(symbols, { width: 40 }, numSeed);

    // 3. Convert to PlacedTiles (Geometry Layout)
    // This replicates the logic we had in SplineTileTrack, but centered here for reusability

    // Note: To return PlacedTile[], we need to compute the layout (turtling).
    // However, PlacedTile requires a 'transform' and 'connections', which implies 3D placement.
    // Ideally this logic should be shared or moved here from SplineTileTrack.

    // For now, to satisfy the prompt's request without a huge refactor of SplineTileTrack's internal logic,
    // we will return the CONFIGS or we need to implement the layouting here.
    // The prompt asks for `PlacedTile[]`. So we MUST implement layouting.

    const placedTiles: PlacedTile[] = [];
    let currentPos = new THREE.Vector3(0, 0, 0);
    let currentDir = new THREE.Vector3(0, 0, 1); // Start (0,0,1)

    configs.forEach((config, i) => {
        const tileStart = currentPos.clone();
        const tileStartDir = currentDir.clone();

        let nextPos = currentPos.clone();
        let nextDir = currentDir.clone();

        if (config.type.includes('straight')) {
            nextPos.addScaledVector(currentDir, config.length);
        } else if (config.type.includes('curve_left')) {
            const axis = new THREE.Vector3(0, 1, 0);
            nextDir.applyAxisAngle(axis, Math.PI / 2);
            nextPos.addScaledVector(currentDir, config.length * 0.6);
            nextPos.addScaledVector(nextDir, config.length * 0.6);
        } else if (config.type.includes('curve_right')) {
            const axis = new THREE.Vector3(0, 1, 0);
            nextDir.applyAxisAngle(axis, -Math.PI / 2);
            nextPos.addScaledVector(currentDir, config.length * 0.6);
            nextPos.addScaledVector(nextDir, config.length * 0.6);
        } else if (config.type.includes('hairpin')) {
            const axis = new THREE.Vector3(0, 1, 0);
            nextDir.applyAxisAngle(axis, Math.PI);
            const side = new THREE.Vector3().crossVectors(currentDir, axis);
            nextPos.addScaledVector(side, 30);
        } else {
            nextPos.addScaledVector(currentDir, config.length);
        }

        nextPos.y += config.elevation;

        placedTiles.push({
            id: `gen-${i}`,
            config,
            transform: new THREE.Matrix4().compose(
                tileStart,
                new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tileStartDir),
                new THREE.Vector3(1, 1, 1)
            ),
            splineRange: { start: 0, end: 0 }, // Assigned later or ignored by usage
            connections: {
                entry: tileStart,
                exit: nextPos.clone(),
                entryTangent: tileStartDir,
                exitTangent: nextDir.clone()
            }
        });

        currentPos = nextPos;
        currentDir = nextDir;
    });

    return placedTiles;
}
