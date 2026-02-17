import { PathTile } from "@/types/TileDef";

export function buildPathFromTiles(tiles: PathTile[], s: number) {
    return tiles.map(t => [
        (t.gx + (t.sx ?? 1) / 2) * s,
        (t.gz + (t.sz ?? 1) / 2) * s
    ] as [number, number]);
}
