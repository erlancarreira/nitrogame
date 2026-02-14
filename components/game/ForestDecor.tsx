"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

type ForestDecorProps = {
  sampledTrack: THREE.Vector3[];
  trackWidth: number;
  seed: string;
};

const ASSET_NAMES = [
  "Tree_1_A_Color1",
  "Tree_1_B_Color1",
  "Tree_2_A_Color1",
  "Rock_1_A_Color1",
  "Rock_2_A_Color1",
  "Bush_1_A_Color1",
  "Bush_2_A_Color1",
];

export function ForestDecor({ sampledTrack, trackWidth, seed }: ForestDecorProps) {
  const meshRefs = useRef<THREE.InstancedMesh[]>([]);
  const { nodes } = useGLTF("/assets/kaykit/forest/tree.glb") as any;

  const meshes = useMemo(() => {
    return ASSET_NAMES.map((name) => {
      const mesh = nodes[name] as THREE.Mesh;
      if (!mesh) {
        console.warn(`Mesh ${name} not found`);
        return { geometry: undefined, material: undefined };
      }
      return {
        geometry: mesh.geometry,
        material: mesh.material,
      };
    });
  }, [nodes]);

  const matricesByAsset = useMemo(() => {
    const matrices: THREE.Matrix4[][] = ASSET_NAMES.map(() => []);
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

        pos.copy(p).addScaledVector(normal, side * outward);

        const assetIndex = Math.floor(rand() * ASSET_NAMES.length);

        const yRot = rand() * Math.PI * 2;
        quat.setFromEuler(new THREE.Euler(0, yRot, 0));

        const s = 0.8 + rand() * 0.6;
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
      {meshes.map((asset, i) => {
        const matrices = matricesByAsset[i] ?? [];
        if (matrices.length === 0) return null;
        if (!asset.geometry || !asset.material) return null;

        return (
          <instancedMesh
            key={ASSET_NAMES[i]}
            ref={(el) => {
              if (el) meshRefs.current[i] = el;
            }}
            args={[asset.geometry, asset.material, matrices.length]}
          />
        );
      })}
    </group>
  );
}

useGLTF.preload("/assets/kaykit/forest/tree.glb");

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
