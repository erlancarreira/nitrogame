"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, ConvexHullCollider } from "@react-three/rapier";
import { cleanPoints } from "@/lib/game/track-utils";

// Collider geometry — reduced from 150 to 60 to prevent Rapier WASM OOM
// (was 300 ConvexHullColliders = 150 × 2 walls, now 120)
const COLLIDER_SAMPLE_COUNT = 60;
const COLLIDER_WALL_HEIGHT = 10.0;
const COLLIDER_WALL_THICKNESS = 20.0;
const COLLIDER_INWARD_SHIFT = 0.8;

interface TrackCollidersProps {
    curve: THREE.CatmullRomCurve3;
    trackWidth: number;
}

export function TrackColliders({ curve, trackWidth }: TrackCollidersProps) {
    const segments = useMemo(() => {
        let points = cleanPoints(curve.getSpacedPoints(COLLIDER_SAMPLE_COUNT));

        if (points.length > 2 && points[points.length - 1].distanceTo(points[0]) < 0.1) {
            points.pop();
        }

        const count = points.length;
        const halfWidth = trackWidth / 2;
        const totalDist = halfWidth - COLLIDER_INWARD_SHIFT;
        const up = new THREE.Vector3(0, 1, 0);
        const wallColliders: Float32Array[] = [];

        for (let i = 0; i < count; i++) {
            const p = points[i];
            const nextP = points[(i + 1) % count];

            const tangent = new THREE.Vector3().subVectors(nextP, p);
            if (tangent.lengthSq() < 0.000001) continue;
            tangent.normalize();

            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            const nextP2 = points[(i + 2) % count];
            const nextTangent = new THREE.Vector3().subVectors(nextP2, nextP).normalize();
            const nextRight = new THREE.Vector3().crossVectors(nextTangent, up).normalize();

            const buildWall = (posA: THREE.Vector3, rA: THREE.Vector3, posB: THREE.Vector3, rB: THREE.Vector3, dist: number, side: number) => {
                const aIn = new THREE.Vector3().copy(posA).addScaledVector(rA, side * dist);
                const aOut = new THREE.Vector3().copy(posA).addScaledVector(rA, side * (dist + COLLIDER_WALL_THICKNESS));
                const bIn = new THREE.Vector3().copy(posB).addScaledVector(rB, side * dist);
                const bOut = new THREE.Vector3().copy(posB).addScaledVector(rB, side * (dist + COLLIDER_WALL_THICKNESS));

                return new Float32Array([
                    aIn.x, 0, aIn.z, aOut.x, 0, aOut.z, bIn.x, 0, bIn.z, bOut.x, 0, bOut.z,
                    aIn.x, COLLIDER_WALL_HEIGHT, aIn.z, aOut.x, COLLIDER_WALL_HEIGHT, aOut.z,
                    bIn.x, COLLIDER_WALL_HEIGHT, bIn.z, bOut.x, COLLIDER_WALL_HEIGHT, bOut.z,
                ]);
            };

            wallColliders.push(buildWall(p, right, nextP, nextRight, totalDist, -1));
            wallColliders.push(buildWall(p, right, nextP, nextRight, totalDist, 1));
        }

        return wallColliders;
    }, [curve, trackWidth]);

    return (
        <RigidBody type="fixed" colliders={false}>
            {segments.map((verts, i) => (
                <ConvexHullCollider key={i} args={[verts]} />
            ))}
        </RigidBody>
    );
}
