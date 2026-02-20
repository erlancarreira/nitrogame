"use client";

import { useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody, TrimeshCollider } from "@react-three/rapier";
import { useMemo } from "react";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Convenção de nomes para colliders automáticos no GLB
// ---------------------------------------------------------------------------
// Qualquer THREE.Mesh cujo name.toLowerCase() comece com um desses prefixos
// recebe automaticamente um RigidBody estático com TrimeshCollider:
//
//   "wall"       → paredes do circuito (wall_a_*, wall_b_*, wall_d_*, wall_e_*, wall_end_*, wall_fence_*)
//   "barriers"   → barreiras contínuas (barriers1, barriers_003, barriers_004, barriers002…)
//   "prop_cone"  → cones de sinalização colocados na pista
//
// Todos os outros meshes são renderizados normalmente, sem collider adicional.
// ---------------------------------------------------------------------------

/** Prefixos (lowercase) que disparam criação de RigidBody estático com trimesh. */
const PHYSICS_PREFIXES = ["wall", "barriers", "prop_cone"] as const;

function isPhysicsMesh(name: string): boolean {
    const lower = name.toLowerCase();
    return PHYSICS_PREFIXES.some((p) => lower.startsWith(p));
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Dados de geometria extraídos de um mesh GLB com transforms já aplicados. */
interface MeshPhysicsData {
    name: string;
    vertices: Float32Array;
    indices: Uint32Array;
}

// Definição de collider extra legado: [halfX, halfY, halfZ, posX, posY, posZ]
// Mantido para compatibilidade com outros mapas que ainda usam o sistema antigo.
export type ExtraCollider = [number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ModelTrackProps {
    url: string;
    scale?: number;
    /**
     * Nome da mesh no GLB para usar como TrimeshCollider de chão.
     * Se não fornecido usa um CuboidCollider genérico como fallback.
     */
    trackMeshName?: string;
    /**
     * Fallback de collider de chão: [halfX, halfZ, centerX, centerY, centerZ].
     * Usado apenas quando trackMeshName está ausente.
     */
    groundCollider?: [number, number, number, number, number];
    /**
     * Colliders cúbicos extras (paredes legadas, ilhas).
     * @deprecated Use meshes nomeados com prefixo "wall", "barriers" ou "prop_cone"
     * no GLB; eles receberão trimesh automático.
     */
    extraColliders?: ExtraCollider[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ModelTrack({
    url,
    scale,
    trackMeshName,
    groundCollider,
    extraColliders,
}: ModelTrackProps) {
    const { scene } = useGLTF(url);
    const s = scale ?? 1;

    // Clona a cena para não mutar o cache do useGLTF (necessário quando a mesma
    // URL é usada mais de uma vez, ex.: preview no menu).
    const clonedScene = useMemo(() => scene.clone(true), [scene]);

    // ── Collider de chão (trimesh a partir de trackMeshName) ──────────────────
    // Necessário bake dos transforms porque KHR_mesh_quantization pode armazenar
    // posições como SHORT (Int16Array) — fromBufferAttribute lê corretamente.
    const trimeshFloor = useMemo<MeshPhysicsData | null>(() => {
        if (!trackMeshName) return null;
        return extractMeshData(clonedScene, trackMeshName, s);
    }, [clonedScene, trackMeshName, s]);

    // ── Auto-colliders para wall*, barriers*, prop_cone* ─────────────────────
    // Percorre a cena completa e extrai geometria de cada mesh que se qualifica.
    const autoColliders = useMemo<MeshPhysicsData[]>(() => {
        const results: MeshPhysicsData[] = [];

        clonedScene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (!isPhysicsMesh(child.name)) return;

            const data = extractMeshDataFromNode(child, s);
            if (data) results.push(data);
        });

        return results;
    }, [clonedScene, s]);

    // Fallback de chão quando não há trackMeshName
    const [hx, hz, cx, cy, cz] = groundCollider ?? [400, 400, 0, 0, -160];

    return (
        <group>
            {/* Visual — toda a cena do GLB */}
            <primitive object={clonedScene} scale={[s, s, s]} />

            {/* ── Collider de chão ────────────────────────────────────────── */}
            {trimeshFloor ? (
                <RigidBody type="fixed" colliders={false}>
                    <TrimeshCollider
                        args={[trimeshFloor.vertices, trimeshFloor.indices]}
                    />
                </RigidBody>
            ) : (
                <RigidBody type="fixed" colliders={false}>
                    {/* Importação dinâmica para não quebrar outros mapas */}
                    <CuboidColliderFallback hx={hx} hz={hz} cx={cx} cy={cy} cz={cz} />
                </RigidBody>
            )}

            {/* ── Auto-colliders: wall*, barriers*, prop_cone* ────────────── */}
            {autoColliders.map((data) => (
                <RigidBody key={`auto-${data.name}`} type="fixed" colliders={false}>
                    <TrimeshCollider args={[data.vertices, data.indices]} />
                </RigidBody>
            ))}

            {/* ── Colliders cúbicos legados (se ainda passados via props) ─── */}
            {extraColliders?.map(([ehx, ehy, ehz, epx, epy, epz], i) => (
                <RigidBody key={`legacy-${i}`} type="fixed" colliders={false}>
                    <CuboidColliderFallback
                        hx={ehx}
                        hz={ehz}
                        cx={epx}
                        cy={epy}
                        cz={epz}
                        hy={ehy}
                    />
                </RigidBody>
            ))}
        </group>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extrai vértices + índices de um mesh pelo nome, com worldMatrix + scale baked.
 * Retorna null se o mesh não for encontrado ou não tiver geometria.
 */
function extractMeshData(
    scene: THREE.Object3D,
    meshName: string,
    scale: number
): MeshPhysicsData | null {
    let found: THREE.Mesh | null = null;

    scene.traverse((child) => {
        if (child.name === meshName && child instanceof THREE.Mesh) {
            found = child;
        }
    });

    if (!found) return null;
    return extractMeshDataFromNode(found as THREE.Mesh, scale);
}

/**
 * Extrai vértices + índices de um THREE.Mesh já localizado,
 * aplicando a worldMatrix do nó e o fator de escala global.
 *
 * fromBufferAttribute é usado deliberadamente para converter tipos SHORT/BYTE
 * (KHR_mesh_quantization) para Float64 antes de gravar em Float32Array —
 * passagem direta de Int16Array para Rapier geraria lixo binário.
 */
function extractMeshDataFromNode(
    mesh: THREE.Mesh,
    scale: number
): MeshPhysicsData | null {
    const geo = mesh.geometry;
    if (!geo) return null;

    mesh.updateWorldMatrix(true, false);
    const worldMatrix = mesh.matrixWorld;

    const posAttr = geo.attributes.position;
    if (!posAttr) return null;

    const count = posAttr.count;
    const vertices = new Float32Array(count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(posAttr, i);
        v.applyMatrix4(worldMatrix);
        if (scale !== 1) v.multiplyScalar(scale);
        vertices[i * 3] = v.x;
        vertices[i * 3 + 1] = v.y;
        vertices[i * 3 + 2] = v.z;
    }

    const index = geo.index;
    const indices = index
        ? new Uint32Array(index.array)
        : new Uint32Array(Array.from({ length: count }, (_, i) => i));

    return { name: mesh.name, vertices, indices };
}

// ---------------------------------------------------------------------------
// Sub-componente de fallback para CuboidCollider
// ---------------------------------------------------------------------------

interface CuboidFallbackProps {
    hx: number;
    hz: number;
    cx: number;
    cy: number;
    cz: number;
    hy?: number; // default 0.5
}

function CuboidColliderFallback({ hx, hz, cx, cy, cz, hy = 0.5 }: CuboidFallbackProps) {
    return (
        <CuboidCollider
            args={[hx, hy, hz]}
            position={[cx, cy - (hy === 0.5 ? 0.5 : 0), cz]}
        />
    );
}
