export type CarPack = {
  id: string;
  name: string;
  models: string[];
};

export const CAR_PACKS: CarPack[] = [
  {
    id: "kart",
    name: "Go Karts",
    models: [
      "/assets/cars/kart/go_kart.glb",
    ],
  },
  {
    id: "kaykit",
    name: "KayKit Free",
    models: [
      "/assets/cars/rally.glb",
      "/assets/cars/coupe.glb",
      "/assets/cars/jeep.glb",
      "/assets/cars/kamaro.glb",
      "/assets/cars/police.glb",
      "/assets/cars/van.glb",
    ],
  },
  {
    id: "designersoup-glb",
    name: "Designersoup Vol.1",
    models: [
      "/assets/cars/designersoup-glb/Beatall.glb",
      "/assets/cars/designersoup-glb/docLorean.glb",
      "/assets/cars/designersoup-glb/Landyroamer.glb",
      "/assets/cars/designersoup-glb/Toyoyo%20Highlight.glb",
      "/assets/cars/designersoup-glb/Tristar%20Racer.glb",
    ],
  },
  {
    id: "styloo",
    name: "Styloo Lowpoly",
    models: [
      "/assets/cars/styloo/carblack.glb",
      "/assets/cars/styloo/carblue.glb",
      "/assets/cars/styloo/cargreen.glb",
      "/assets/cars/styloo/cargreenvariant1.glb",
      "/assets/cars/styloo/cargreenvariant2.glb",
      "/assets/cars/styloo/carred.glb",
      "/assets/cars/styloo/carwhite.glb",
      "/assets/cars/styloo/caryellow.glb",
      "/assets/cars/styloo/caryellowvariant.glb",
    ],
  },
];

export const ALL_CAR_MODELS = CAR_PACKS.flatMap((p) => p.models);
export const DEFAULT_CAR_MODEL = ALL_CAR_MODELS[0];

export function getPackById(id?: string) {
  return CAR_PACKS.find((p) => p.id === id) ?? CAR_PACKS[0];
}

export function getNextCarModelInPack(packId?: string, current?: string) {
  const pack = getPackById(packId);
  if (!current) return pack.models[0];
  const idx = pack.models.indexOf(current);
  if (idx === -1) return pack.models[0];
  return pack.models[(idx + 1) % pack.models.length];
}

export function getNextPackId(current?: string) {
  const idx = CAR_PACKS.findIndex((p) => p.id === current);
  if (idx === -1) return CAR_PACKS[0].id;
  return CAR_PACKS[(idx + 1) % CAR_PACKS.length].id;
}

export function getModelScale(url?: string): number {
  if (!url) return 0.6;
  if (url.includes("go_kart.glb")) return 0.025; // Significant reduction
  return 0.6;
}
