"use client";

import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider, TrimeshCollider } from "@react-three/rapier";
import { useMemo } from "react";
import * as THREE from "three";

// Definição de collider extra: [halfX, halfY, halfZ, posX, posY, posZ]
export type ExtraCollider = [number, number, number, number, number, number];

interface ModelTrackProps {
    url: string;
    scale?: number;
    // Nome da mesh no GLB para usar como trimesh collider (substituí cuboid de chão)
    trackMeshName?: string;
    // Collider de chão: [halfX, halfZ, centerX, centerY, centerZ]
    groundCollider?: [number, number, number, number, number];
    // Colliders extras para paredes/barreiras (independentes do chão)
    extraColliders?: ExtraCollider[];
}

export function ModelTrack({ url, scale, trackMeshName, groundCollider, extraColliders }: ModelTrackProps) {
    const { scene } = useGLTF(url);
    const s = scale || 1;
    const clonedScene = useMemo(() => scene.clone(true), [scene]);

    // Extrair vértices/índices com transforms baked em Float32 para Rapier.
    // Necessário porque KHR_mesh_quantization armazena posições como SHORT normalized
    // (Int16Array) — passar direto como Float32Array dá lixo binário.
    const trimeshData = useMemo<{ vertices: Float32Array; indices: Uint32Array } | null>(() => {
        if (!trackMeshName) return null;

        let result: { vertices: Float32Array; indices: Uint32Array } | null = null;

        clonedScene.traverse((child) => {
            if (child.name === trackMeshName && (child as THREE.Mesh).geometry) {
                const mesh = child as THREE.Mesh;
                const geo = mesh.geometry;

                // Matriz mundo do nó (translation + rotation + scale da hierarquia GLB)
                mesh.updateWorldMatrix(true, false);
                const worldMatrix = mesh.matrixWorld;

                // Ler cada vértice via fromBufferAttribute (desnormaliza SHORT→float),
                // aplicar matrizWorld + scale do <primitive>
                const posAttr = geo.attributes.position;
                const count = posAttr.count;
                const vertices = new Float32Array(count * 3);
                const v = new THREE.Vector3();

                for (let i = 0; i < count; i++) {
                    v.fromBufferAttribute(posAttr, i);
                    v.applyMatrix4(worldMatrix);
                    if (s !== 1) v.multiplyScalar(s);
                    vertices[i * 3] = v.x;
                    vertices[i * 3 + 1] = v.y;
                    vertices[i * 3 + 2] = v.z;
                }

                // Índices: converter para Uint32 (pode ser Uint16 no GLB)
                const index = geo.index;
                const indices = index
                    ? new Uint32Array(index.array)
                    : new Uint32Array(Array.from({ length: count }, (_, i) => i));

                result = { vertices, indices };
            }
        });

        return result;
    }, [clonedScene, trackMeshName, s]);

    // Default: plano grande em Y=0, centro Z=-160
    const [hx, hz, cx, cy, cz] = groundCollider || [400, 400, 0, 0, -160];

    return (
        <group>
            <primitive object={clonedScene} scale={[s, s, s]} />

            {/* Collider de chão: trimesh (geometria do modelo) ou cuboid (fallback) */}
            {trimeshData ? (
                <RigidBody type="fixed" colliders={false}>
                    <TrimeshCollider
                        args={[trimeshData.vertices, trimeshData.indices]}
                    />
                </RigidBody>
            ) : (
                <RigidBody type="fixed" colliders={false}>
                    <CuboidCollider
                        args={[hx, 0.5, hz]}
                        position={[cx, cy - 0.5, cz]}
                    />
                </RigidBody>
            )}

            {/* Colliders extras (paredes, barreiras) */}
            {extraColliders && extraColliders.map(([ehx, ehy, ehz, epx, epy, epz], i) => (
                <RigidBody key={`extra-${i}`} type="fixed" colliders={false}>
                    <CuboidCollider
                        args={[ehx, ehy, ehz]}
                        position={[epx, epy, epz]}
                    />
                </RigidBody>
            ))}
        </group>
    );
}
