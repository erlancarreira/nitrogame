import { TrackTemplate } from "./grammar";

export const CIRCUIT_OVAL: TrackTemplate = {
    name: 'Oval Circuit',
    axiom: ['S', 'F', 'F', 'L', 'F', 'F', 'R'],
    rules: [
        { symbol: 'F', replacements: [{ symbols: ['F', 'F'], probability: 0.3 }] },
        { symbol: 'L', replacements: [{ symbols: ['L', 'F', 'L'], probability: 0.2 }] }
    ],
    iterations: 3,
    constraints: {
        minLength: 200,
        maxLength: 800,
        forceLoop: true
    }
};

export const CIRCUIT_TECHNICAL: TrackTemplate = {
    name: 'Technical Circuit',
    axiom: ['S', 'F', 'L', 'F', 'R', 'F', 'L', 'L', 'F', 'R'],
    rules: [
        { symbol: 'F', replacements: [{ symbols: ['F', 'F', 'F'], probability: 0.4 }] },
        { symbol: 'L', replacements: [{ symbols: ['L', 'L'], probability: 0.5 }] },
        { symbol: 'R', replacements: [{ symbols: ['R', 'R'], probability: 0.5 }] }
    ],
    iterations: 4,
    constraints: {
        minLength: 500,
        maxLength: 1500,
        forceLoop: true
    }
};

export const FIGURE_EIGHT: TrackTemplate = {
    name: 'Figure 8',
    axiom: ['S', 'F', 'F', 'L', 'F', 'F', 'L', 'F', 'F', 'L', 'L', 'F', 'F', 'L', 'F'],
    rules: [
        { symbol: 'F', replacements: [{ symbols: ['F', 'F'], probability: 0.3 }] }
    ],
    iterations: 2,
    constraints: {
        minLength: 300,
        maxLength: 1000,
        forceLoop: true
    }
};

export const TEMPLATE_RAINBOW_HARD: TrackTemplate = {
    name: 'Rainbow Hard',
    axiom: ['S', 'F', 'U', 'F', 'R', 'F', 'U', 'F', 'L', 'F', 'E'],
    rules: [
        { symbol: 'F', replacements: [{ symbols: ['F', 'F'], probability: 0.5 }] }
    ],
    iterations: 2,
    constraints: {
        minLength: 400,
        maxLength: 2000,
        forceLoop: false // Point to point
    }
};
