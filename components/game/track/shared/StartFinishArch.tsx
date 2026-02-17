"use client";

import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";

// ── Shared geometries (module-level singletons) ──────────────────────
let _archPillarGeo: THREE.BoxGeometry | null = null;
let _archBarGeo: THREE.BoxGeometry | null = null;
let _checkerGeo: THREE.BoxGeometry | null = null;
const _archPillarMat = new THREE.MeshStandardMaterial({ color: "#333" });
const _checkerMatBlack = new THREE.MeshStandardMaterial({ color: "#000000" });
const _checkerMatWhite = new THREE.MeshStandardMaterial({ color: "#ffffff" });

function getArchGeo() {
    if (!_archPillarGeo) _archPillarGeo = new THREE.BoxGeometry(1, 8, 1);
    if (!_archBarGeo) _archBarGeo = new THREE.BoxGeometry(1, 1, 1); // width set via scale
    if (!_checkerGeo) _checkerGeo = new THREE.BoxGeometry(0.9, 0.4, 0.9);
    return { pillarGeo: _archPillarGeo, barGeo: _archBarGeo, checkerGeo: _checkerGeo };
}

interface StartFinishArchProps {
    position: [number, number, number];
    rotation: [number, number, number];
    trackWidth: number;
    barrierColor: string;
}

export function StartFinishArch({ position, rotation, trackWidth, barrierColor }: StartFinishArchProps) {
    const { pillarGeo, barGeo, checkerGeo } = getArchGeo();
    const barMat = useMemo(() => new THREE.MeshStandardMaterial({ color: barrierColor }), [barrierColor]);

    const checkerCount = Math.ceil(trackWidth + 2);
    const blackRef = useRef<THREE.InstancedMesh>(null);
    const whiteRef = useRef<THREE.InstancedMesh>(null);

    useEffect(() => {
        if (!blackRef.current || !whiteRef.current) return;
        let bIdx = 0, wIdx = 0;
        const m = new THREE.Matrix4();

        for (let i = 0; i < checkerCount; i++) {
            const x = -(trackWidth / 2 + 1) + i + 0.5;
            m.makeTranslation(x, 9.1, 0);
            if (i % 2 === 0) {
                blackRef.current.setMatrixAt(bIdx++, m);
            } else {
                whiteRef.current.setMatrixAt(wIdx++, m);
            }
        }
        blackRef.current.count = bIdx;
        whiteRef.current.count = wIdx;
        blackRef.current.instanceMatrix.needsUpdate = true;
        whiteRef.current.instanceMatrix.needsUpdate = true;
    }, [checkerCount, trackWidth]);

    const blackCount = Math.ceil(checkerCount / 2);
    const whiteCount = Math.floor(checkerCount / 2);

    return (
        <group position={position} rotation={rotation}>
            {/* Pillars — shared geometry + material */}
            <mesh position={[-(trackWidth / 2 + 0.5), 4, 0]} castShadow geometry={pillarGeo} material={_archPillarMat} />
            <mesh position={[trackWidth / 2 + 0.5, 4, 0]} castShadow geometry={pillarGeo} material={_archPillarMat} />

            {/* Top bar — shared geometry, scaled */}
            <mesh position={[0, 8.5, 0]} castShadow geometry={barGeo} material={barMat} scale={[trackWidth + 2, 1, 1]} />

            {/* Checkered pattern — 2 InstancedMeshes (black + white) instead of N individual meshes */}
            <instancedMesh ref={blackRef} args={[checkerGeo, _checkerMatBlack, blackCount]} />
            <instancedMesh ref={whiteRef} args={[checkerGeo, _checkerMatWhite, whiteCount]} />
        </group>
    );
}
