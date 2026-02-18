// Layout "Turbo Speedway" — Kenney Racing Kit
// TILE_SIZE = 20m. roadCornerLarge é 2×2 tiles (40×40m).
//
// Convenções de rotação confirmadas pelo código funcional:
//   rot=  0 → canto BottomRight: entrada  Sul(+Z), saída Leste(+X)   — ou entrada Leste, saída Sul
//   rot= 90 → canto BottomLeft:  entrada  Sul(+Z), saída Oeste(-X)   — ou entrada Oeste, saída Sul
//   rot=180 → canto TopLeft:     entrada Norte(-Z), saída Oeste(-X)  — ou entrada Oeste, saída Norte
//   rot=270 → canto TopRight:    entrada Norte(-Z), saída Leste(+X)  — ou entrada Leste, saída Norte
//
// Para retas:  rot=0/180 → eixo Z (N-S) | rot=90/270 → eixo X (E-W)
//
// ─── PLANTA DO CIRCUITO ────────────────────────────────────────────────
//
//  gz:  0   [←←← Back Straight: gx=4..11 ←←←]   [Turn2 gx=12,gz=0 2×2]
//       2                                           [      gx=12,gz=1    ]
//       3   [Turn3 gx=0,gz=3 2×2]
//       4   [      gx=0,gz=4    ]
//       5   gx=2 ↓  (left section)                 gx=13 ↓ (right str.)
//       6   gx=2 ↓                                  gx=13 ↓
//       7   gx=2 ↓    chicane ←                     gx=13 ↓
//       8   gx=0 ↓  (after chicane)                 gx=13 ↓
//       9   gx=0 ↓                                  gx=13 ↓
//      10   gx=0 ↓                                  gx=13 ↓
//      11   [Turn4 gx=0,gz=11 2×2] → [Main: gx=2..11 →] [Turn1 gx=12,gz=11 2×2]
//      12   [      gx=0,gz=12    ]                        [      gx=12,gz=12    ]
//
// Circuito fechado, sem colisões de coordenadas.
//
// Coordenada mundial do centro: X = (gx + sx/2) * 20,  Z = (gz + sz/2) * 20

export interface TileDef {
    model: string;
    gx: number;
    gz: number;
    rot: number;
    sx?: number;
    sz?: number;
    y?: number;
}

export const TURBO_TILES: TileDef[] = [

    // ════════════════════════════════════════════════════════════
    //  RETA PRINCIPAL  gz=11, gx=2..11, → Leste (+X)
    //  rot=90 (reta no eixo X)
    // ════════════════════════════════════════════════════════════
    { model: 'roadStraight', gx: 2,  gz: 11, rot: 90 },
    { model: 'roadStraight', gx: 3,  gz: 11, rot: 90 },
    { model: 'roadStraight', gx: 4,  gz: 11, rot: 90 },
    { model: 'roadStart',    gx: 5,  gz: 11, rot: 90 },  // largada
    { model: 'roadPitEntry', gx: 6,  gz: 11, rot: 90 },  // entrada pit
    { model: 'roadStraight', gx: 7,  gz: 11, rot: 90 },
    { model: 'roadStraight', gx: 8,  gz: 11, rot: 90 },
    { model: 'roadStraight', gx: 9,  gz: 11, rot: 90 },
    { model: 'roadStraight', gx: 10, gz: 11, rot: 90 },
    { model: 'roadStraight', gx: 11, gz: 11, rot: 90 },

    // ════════════════════════════════════════════════════════════
    //  TURN 1 — Bottom Right  gx=12, gz=11 (2×2)
    //  Kart vem do Oeste (+X), sai para Norte (-Z)
    //  rot=270 (TopRight: entrada Leste/Oeste, saída Norte)
    // ════════════════════════════════════════════════════════════
    { model: 'roadCornerLarge', gx: 12, gz: 11, rot: 270, sx: 2, sz: 2 },

    // ════════════════════════════════════════════════════════════
    //  RETA DIREITA  gx=13, gz=2..10, ↑ Norte (-Z)
    //  rot=0 (reta no eixo Z)
    // ════════════════════════════════════════════════════════════
    { model: 'roadStraight', gx: 13, gz: 10, rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 9,  rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 8,  rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 7,  rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 6,  rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 5,  rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 4,  rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 3,  rot: 0 },
    { model: 'roadStraight', gx: 13, gz: 2,  rot: 0 },

    // ════════════════════════════════════════════════════════════
    //  TURN 2 — Top Right  gx=12, gz=0 (2×2)
    //  Kart vem do Sul (+Z→-Z), sai para Oeste (-X)
    //  rot=90 (BottomLeft: entrada Sul, saída Oeste)
    // ════════════════════════════════════════════════════════════
    { model: 'roadCornerLarge', gx: 12, gz: 0, rot: 90, sx: 2, sz: 2 },

    // ════════════════════════════════════════════════════════════
    //  BACK STRAIGHT  gz=1, gx=4..11, ← Oeste (-X)
    //  rot=90 (reta no eixo X)
    //  gz=1 porque a curva 2x2 ocupa gz=0 e gz=1 (centro em gz=1)
    // ════════════════════════════════════════════════════════════
    { model: 'roadStraight', gx: 11, gz: 1, rot: 90 },
    { model: 'roadStraight', gx: 10, gz: 1, rot: 90 },
    { model: 'roadStraight', gx: 9,  gz: 1, rot: 90 },
    { model: 'roadStraight', gx: 8,  gz: 1, rot: 90 },
    { model: 'roadStraight', gx: 7,  gz: 1, rot: 90 },
    { model: 'roadStraight', gx: 6,  gz: 1, rot: 90 },
    { model: 'roadStraight', gx: 5,  gz: 1, rot: 90 },
    { model: 'roadStraight', gx: 4,  gz: 1, rot: 90 },

    // ════════════════════════════════════════════════════════════
    //  TURN 3 — Top Left  gx=2, gz=0 (2×2)
    //  Kart vem do Leste (-X), sai para Sul (+Z)
    //  rot=0 (BottomRight: entrada Leste, saída Sul)
    // ════════════════════════════════════════════════════════════
    { model: 'roadCornerLarge', gx: 2, gz: 0, rot: 0, sx: 2, sz: 2 },

    // ════════════════════════════════════════════════════════════
    //  SEÇÃO ESQUERDA — Chicane em S
    //  Sai do Turn3 (gz=0..1, gx=2..3) → desce pelo gx=3
    // ════════════════════════════════════════════════════════════

    // Descida norte (gx=3, gz=2..5)
    { model: 'roadStraight', gx: 3, gz: 2, rot: 0 },
    { model: 'roadStraight', gx: 3, gz: 3, rot: 0 },
    { model: 'roadStraight', gx: 3, gz: 4, rot: 0 },
    { model: 'roadStraight', gx: 3, gz: 5, rot: 0 },

    // Chicane-A: vira para Oeste (gx=3,gz=6)
    // Entrada Norte(cima), saída Oeste → TopLeft → rot=180
    { model: 'roadCornerSmall', gx: 3, gz: 6, rot: 180 },

    // Trecho Oeste da chicane (gx=1..2, gz=6)
    { model: 'roadStraight', gx: 2, gz: 6, rot: 90 },
    { model: 'roadStraight', gx: 1, gz: 6, rot: 90 },

    // Chicane-B: vira para Sul (gx=0,gz=6)
    // Entrada Leste(direita vindo Oeste), saída Sul → BottomRight → rot=0
    { model: 'roadCornerSmall', gx: 0, gz: 6, rot: 0 },

    // Descida final (gx=0, gz=7..10)
    { model: 'roadStraight', gx: 0, gz: 7,  rot: 0 },
    { model: 'roadStraight', gx: 0, gz: 8,  rot: 0 },
    { model: 'roadStraight', gx: 0, gz: 9,  rot: 0 },
    { model: 'roadStraight', gx: 0, gz: 10, rot: 0 },

    // ════════════════════════════════════════════════════════════
    //  TURN 4 — Bottom Left  gx=0, gz=11 (2×2)
    //  Kart vem do Norte (-Z→+Z), sai para Leste (+X)
    //  rot=270 (TopRight: entrada Norte, saída Leste)
    // ════════════════════════════════════════════════════════════
    { model: 'roadCornerLarge', gx: 0, gz: 11, rot: 270, sx: 2, sz: 2 },

    // Conector Turn4 → reta principal (gx=2 é primeiro tile da reta)
    // A curva 2x2 ocupa gx=0..1, gz=11..12. Saída é em gx=2.
    // Sem tile extra necessário — gx=2,gz=11 é o primeiro da reta principal. ✓
];

// ═══════════════════════════════════════════════════════════════════════════
//  DECORAÇÃO
//  Zonas seguras (fora da pista):
//    Norte: gz = -1, -2  (arquibancadas)
//    Sul:   gz = 13, 14  (pits, garagens)
//    Direita: gx = 15+   (billboards)
//    Interior: gx=4..10, gz=3..9  (árvores)
// ═══════════════════════════════════════════════════════════════════════════
export const TURBO_DECOR: TileDef[] = [

    // ── PIT LANE (Sul da reta principal, gz=13) ───────────────────────────
    { model: 'roadPitStraight', gx: 6,  gz: 13, rot: 90 },
    { model: 'roadPitStraight', gx: 7,  gz: 13, rot: 90 },
    { model: 'roadPitStraight', gx: 8,  gz: 13, rot: 90 },
    { model: 'roadPitStraight', gx: 9,  gz: 13, rot: 90 },
    { model: 'roadPitStraight', gx: 10, gz: 13, rot: 90 },

    // ── GARAGENS (gz=14) ──────────────────────────────────────────────────
    { model: 'pitsGarage',       gx: 6,  gz: 14, rot: 0 },
    { model: 'pitsGarage',       gx: 7,  gz: 14, rot: 0 },
    { model: 'pitsGarage',       gx: 8,  gz: 14, rot: 0 },
    { model: 'pitsGarageClosed', gx: 9,  gz: 14, rot: 0 },
    { model: 'pitsOffice',       gx: 10, gz: 14, rot: 0 },

    // ── ARQUIBANCADAS (Norte da reta principal, gz=-1) ────────────────────
    { model: 'grandStandCovered', gx: 4,  gz: -1, rot: 180 },
    { model: 'grandStandCovered', gx: 5,  gz: -1, rot: 180 },
    { model: 'grandStandCovered', gx: 6,  gz: -1, rot: 180 },
    { model: 'grandStandCovered', gx: 7,  gz: -1, rot: 180 },
    { model: 'grandStandCovered', gx: 8,  gz: -1, rot: 180 },
    { model: 'grandStand',        gx: 9,  gz: -1, rot: 180 },
    { model: 'grandStand',        gx: 10, gz: -1, rot: 180 },

    // ── POSTES DE LUZ ─────────────────────────────────────────────────────
    { model: 'lightPostModern', gx: 5,  gz: 10, rot: 0 },
    { model: 'lightPostModern', gx: 9,  gz: 10, rot: 0 },
    { model: 'lightPostLarge',  gx: 15, gz: 6,  rot: 0 },

    // ── BANNERS ───────────────────────────────────────────────────────────
    { model: 'bannerTowerRed',   gx: 4,  gz: -1, rot: 180 },
    { model: 'bannerTowerGreen', gx: 11, gz: -1, rot: 180 },

    // ── ARCO START/FINISH (sobre gx=5,gz=11) ──────────────────────────────
    { model: 'overheadLights', gx: 5, gz: 11, rot: 90 },

    // ── TENDAS (exterior Norte, gz=-2) ────────────────────────────────────
    { model: 'tentClosedLong', gx: 5, gz: -2, rot: 0 },
    { model: 'tentClosed',     gx: 8, gz: -2, rot: 0 },

    // ── ÁRVORES (interior: gx=4..11, gz=3..9) ────────────────────────────
    { model: 'treeLarge', gx: 5,  gz: 3, rot: 0 },
    { model: 'treeLarge', gx: 7,  gz: 3, rot: 0 },
    { model: 'treeLarge', gx: 9,  gz: 3, rot: 0 },
    { model: 'treeLarge', gx: 11, gz: 3, rot: 0 },
    { model: 'treeSmall', gx: 6,  gz: 5, rot: 0 },
    { model: 'treeSmall', gx: 8,  gz: 5, rot: 0 },
    { model: 'treeSmall', gx: 10, gz: 5, rot: 0 },
    { model: 'treeLarge', gx: 5,  gz: 7, rot: 0 },
    { model: 'treeLarge', gx: 8,  gz: 7, rot: 0 },
    { model: 'treeLarge', gx: 11, gz: 7, rot: 0 },
    { model: 'treeSmall', gx: 6,  gz: 9, rot: 0 },
    { model: 'treeSmall', gx: 9,  gz: 9, rot: 0 },

    // ── BILLBOARDS (exterior direito, gx=15) ──────────────────────────────
    { model: 'billboard',    gx: 15, gz: 4,  rot: 90 },
    { model: 'billboardLow', gx: 15, gz: 8,  rot: 90 },

    // ── CARROS NO PIT ──────────────────────────────────────────────────────
    { model: 'raceCarRed',    gx: 7,  gz: 14, rot: 90 },
    { model: 'raceCarOrange', gx: 8,  gz: 14, rot: 90 },
];
