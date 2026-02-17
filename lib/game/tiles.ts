import type { TileDef } from "@/types/TileDef";

export const CIRCUIT_TILES: TileDef[] = [
    { gx: 0, gz: 0 },
    { gx: 1, gz: 0 },
    { gx: 2, gz: 0 },
    { gx: 3, gz: 0 },

    { gx: 4, gz: -1, sx: 2, sz: 2 },

    { gx: 6, gz: -3 },
    { gx: 6, gz: -5 },
    { gx: 6, gz: -7 },

    { gx: 5, gz: -9, sx: 3, sz: 2 },

    { gx: 2, gz: -10 },
    { gx: 0, gz: -10 },
    { gx: -2, gz: -10 },

    { gx: -4, gz: -9, sx: 2, sz: 2 },

    { gx: -5, gz: -7 },
    { gx: -5, gz: -5 },
    { gx: -5, gz: -3 },

    { gx: -4, gz: -1, sx: 2, sz: 2 },

    { gx: -2, gz: 0 },
];
