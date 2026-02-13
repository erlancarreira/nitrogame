"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

type ForestDecorProps = {
  sampledTrack: THREE.Vector3[];
  trackWidth: number;
  seed: string;
};

type AssetDef = {
  url: string;
  baseScale: number;
};

const ASSETS: AssetDef[] = [
  { url: "/assets/kaykit/forest/Tree_1_A_Color1.gltf", baseScale: 1.2 },
  { url: "/assets/kaykit/forest/Tree_1_B_Color1.gltf", baseScale: 1.1 },
  { url: "/assets/kaykit/forest/Tree_2_A_Color1.gltf", baseScale: 1.15 },
  { url: "/assets/kaykit/forest/Rock_1_A_Color1.gltf", baseScale: 0.9 },
  { url: "/assets/kaykit/forest/Rock_2_A_Color1.gltf", baseScale: 0.85 },
  { url: "/assets/kaykit/forest/Bush_1_A_Color1.gltf", baseScale: 0.9 },
  { url: "/assets/kaykit/forest/Bush_2_A_Color1.gltf", baseScale: 0.85 },
];

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function useFirstMesh(url: string) {
  const gltf = useGLTF(url);
  return useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((obj) => {
      if (!mesh && (obj as THREE.Mesh).isMesh) {
        mesh = obj as THREE.Mesh;
      }
    });
    if (!mesh) {
      console.warn(`No mesh found in ${url}`);
      return {
        geometry: undefined,
        material: undefined,
      };
    }
    const foundMesh = mesh as unknown as THREE.Mesh;
    return {
      geometry: foundMesh.geometry,
      material: foundMesh.material as THREE.Material,
    };
  }, [gltf, url]);
}

export function ForestDecor({ sampledTrack, trackWidth, seed }: ForestDecorProps) {
  const meshRefs = useRef<THREE.InstancedMesh[]>([]);
  const assetMeshes = ASSETS.map((a) => useFirstMesh(a.url));

  const matricesByAsset = useMemo(() => {
    const matrices: THREE.Matrix4[][] = ASSETS.map(() => []);
    if (sampledTrack.length < 2) return matrices;

    const rand = mulberry32(hashSeed(seed));
    const step = 16;
    const baseOffset = trackWidth / 2 + 10;
    const normal = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < sampledTrack.length; i += step) {
      const p = sampledTrack[i];
      const n = sampledTrack[(i + 1) % sampledTrack.length];
      if (!p || !n) continue;

      dir.subVectors(n, p).normalize();
      normal.set(-dir.z, 0, dir.x);

      for (const side of [-1, 1]) {
        if (rand() < 0.6) continue;
        const jitter = 8 + rand() * 8;
        const outward = baseOffset + jitter;
        pos
          .copy(p)
          .addScaledVector(normal, side * outward);
        const r = rand();
        let assetIndex = 0;
        if (r < 0.55) assetIndex = Math.floor(rand() * 3); // trees
        else if (r < 0.8) assetIndex = 5 + Math.floor(rand() * 2); // bushes
        else assetIndex = 3 + Math.floor(rand() * 2); // rocks

        const yRot = rand() * Math.PI * 2;
        quat.setFromEuler(new THREE.Euler(0, yRot, 0));
        const s = ASSETS[assetIndex].baseScale * (0.8 + rand() * 0.6);
        scale.set(s, s, s);

        const m = new THREE.Matrix4();
        m.compose(pos, quat, scale);
        matrices[assetIndex].push(m);
      }
    }

    return matrices;
  }, [sampledTrack, trackWidth, seed]);

  useEffect(() => {
    matricesByAsset.forEach((matrices, i) => {
      const mesh = meshRefs.current[i];
      if (!mesh) return;
      matrices.forEach((m, idx) => {
        mesh.setMatrixAt(idx, m);
      });
      mesh.count = matrices.length;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [matricesByAsset]);

  return (
    <group>
      {ASSETS.map((asset, i) => {
        const matrices = matricesByAsset[i] ?? [];
        if (matrices.length === 0) return null;
        const { geometry, material } = assetMeshes[i];
        if (!geometry || !material) return null;
        return (
          <instancedMesh
            key={asset.url}
            ref={(el) => {
              if (el) meshRefs.current[i] = el;
            }}
            args={[geometry, material, matrices.length]}
          />
        );
      })}
    </group>
  );
}

ASSETS.forEach((a) => useGLTF.preload(a.url));
