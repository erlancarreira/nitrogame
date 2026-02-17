"use client";

import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Line, useTexture } from "@react-three/drei";
import type { MapConfig } from "@/lib/game/maps";
import { generateTrackPath, cleanPoints } from "@/lib/game/track-utils";
import { TrackColliders } from "./shared/TrackColliders";
import { StartFinishArch } from "./shared/StartFinishArch";
import { GroundPlane } from "./shared/GroundPlane";
import { ForestDecor } from "../ForestDecor";
import { RacingKitDecor } from "../RacingKitDecor";

// Constants (migrated from Track.tsx)
const EDGE_STRIPE_WIDTH = 1.2;
const EDGE_BLEND_EXTRA = 0.3;
const CHEVRON_PAIR_GAP = 1.4;
const CHEVRON_Y = 0.15;
const CHEVRON_SCALE = 1.8;
const CHEVRON_SKIP_RATIO = 0.08;
const MESH_SAMPLES_CUSTOM = 500;
const MESH_SAMPLES_DEFAULT = 300;
const WALL_HEIGHT = 2.5;
const WALL_THICKNESS = 0.5;
const WALL_COLOR_BAND_SIZE = 5;
const WORLD_SCALE = 20;
const PROP_BASE_SCALE = 5;
const PROP_RATIO = PROP_BASE_SCALE / WORLD_SCALE;

// Helper: Seeded RNG
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

interface SplineTrackProps {
    map: MapConfig;
    showWaypoints?: boolean;
    showArrows?: boolean;
    showCenterLine?: boolean;
}

export function SplineTrack({
    map,
    showWaypoints = false,
    showArrows = true,
    showCenterLine = true,
}: SplineTrackProps) {
    const {
        trackWidth, trackLength, curveRadius,
        trackColor, grassColor, barrierColors,
        decorationType,
    } = map;

    const trackPath = useMemo(() => generateTrackPath(map), [map]);
    const hasCustomPath = (map.pathPoints?.length ?? 0) > 2;

    const racingLineCurve = useMemo(
        () => new THREE.CatmullRomCurve3(trackPath, true),
        [trackPath],
    );

    const startLine = useMemo(() => {
        const start = trackPath[0] ?? new THREE.Vector3(0, 0, 0);
        const next = trackPath[1] ?? new THREE.Vector3(0, 0, 1);
        const dir = new THREE.Vector3().subVectors(next, start).normalize();
        const angle = Math.atan2(dir.x, dir.z);
        return {
            position: [start.x, 0.1, start.z] as [number, number, number],
            rotation: [0, angle, 0] as [number, number, number],
        };
    }, [trackPath]);

    const sampledTrack = useMemo(() => {
        const count = hasCustomPath
            ? Math.max(120, trackPath.length * 6)
            : Math.max(56, trackPath.length * 2);
        return racingLineCurve.getSpacedPoints(count);
    }, [racingLineCurve, trackPath.length, hasCustomPath]);

    const linePoints = useMemo(
        () => sampledTrack.map((p) => new THREE.Vector3(p.x, 0.08, p.z)),
        [sampledTrack],
    );

    // ── Chevron direction indicators ──────────────────────────────
    const chevronGeometry = useMemo(() => {
        const shape = new THREE.Shape();
        const W = 1.0, H = 0.8, T = 0.22;
        shape.moveTo(0, H);
        shape.lineTo(-W, 0);
        shape.lineTo(-W + T, 0);
        shape.lineTo(0, H - T * 1.2);
        shape.lineTo(W - T, 0);
        shape.lineTo(W, 0);
        shape.closePath();
        return new THREE.ShapeGeometry(shape);
    }, []);

    const chevronTransforms = useMemo(() => {
        if (!showArrows || sampledTrack.length < 2) return [];
        const pts = sampledTrack;
        const skip = Math.floor(pts.length * CHEVRON_SKIP_RATIO);
        const spacing = Math.max(1, Math.floor(pts.length / 40));
        const markers = pts.filter((_, i) => i % spacing === 0 && i >= skip && i < pts.length - skip);
        const matrices: THREE.Matrix4[] = [];

        markers.forEach((point, i, arr) => {
            const nextPoint = arr[(i + 1) % arr.length];
            if (!nextPoint) return;
            const dir = new THREE.Vector3().subVectors(nextPoint, point).normalize();
            const angle = Math.atan2(dir.x, dir.z);

            for (let c = 0; c < 2; c++) {
                const offset = (c - 0.5) * CHEVRON_PAIR_GAP; // center pair around track point
                const m = new THREE.Matrix4();
                const pos = new THREE.Vector3(point.x + dir.x * offset, CHEVRON_Y, point.z + dir.z * offset);
                const rot = new THREE.Euler(-Math.PI / 2, 0, angle + Math.PI);
                m.compose(pos, new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(CHEVRON_SCALE, CHEVRON_SCALE, 1));
                matrices.push(m);
            }
        });
        return matrices;
    }, [sampledTrack, showArrows]);

    const chevronsRef = useRef<THREE.InstancedMesh>(null);
    useEffect(() => {
        if (!chevronsRef.current) return;
        chevronTransforms.forEach((m, i) => chevronsRef.current!.setMatrixAt(i, m));
        chevronsRef.current.instanceMatrix.needsUpdate = true;
    }, [chevronTransforms]);

    const chevronMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        color: "#FF8C00",
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
    }), []);

    // ── Ground Plane Sizing ───────────────────────────────────────
    const groundSizeX = Math.max(400, curveRadius * 6) + trackWidth * 6;
    const groundSizeZ = Math.max(500, trackLength * 2) + trackWidth * 6;

    const isRacingKit = (decorationType as string) === "racing-kit";

    return (
        <group>
            {/* Visual Mesh */}
            {!isRacingKit && (
                <TrackMeshes
                    trackWidth={trackWidth}
                    curve={racingLineCurve}
                    trackColor={trackColor}
                    barrierColors={barrierColors}
                    hasCustomPath={hasCustomPath}
                    textureUrl={map.textureUrl}
                    textureScale={map.textureScale}
                    textureCrop={map.textureCrop}
                />
            )}

            {/* Physics */}
            <TrackColliders trackWidth={trackWidth} curve={racingLineCurve} />

            {/* Ground */}
            <GroundPlane
                grassColor={grassColor}
                sizeX={groundSizeX}
                sizeZ={groundSizeZ}
                seed={map.id}
            />

            {/* Debug Waypoints */}
            {showWaypoints &&
                trackPath
                    .filter((_, i) => i % 4 === 0)
                    .map((point, i) => (
                        <mesh key={`wp-${i}`} position={[point.x, 20.5, point.z]}>
                            <sphereGeometry args={[2, 8, 8]} />
                            <meshStandardMaterial color="#ff00ff" transparent opacity={0.8} />
                        </mesh>
                    ))}

            {/* Center Line */}
            {showCenterLine && !isRacingKit && <Line points={linePoints} color="#ffffff" lineWidth={1} />}

            {/* Decorations */}
            {decorationType === "forest" ? (
                <React.Suspense fallback={null}>
                    <ForestDecor sampledTrack={sampledTrack} trackWidth={trackWidth} seed={map.id} />
                </React.Suspense>
            ) : isRacingKit ? (
                <React.Suspense fallback={null}>
                    <RacingKitDecor sampledTrack={sampledTrack} trackWidth={trackWidth} />
                </React.Suspense>
            ) : (
                <React.Suspense fallback={null}>
                    <ProceduralDecor type={decorationType} sampledTrack={sampledTrack} trackWidth={trackWidth} seed={map.id} />
                </React.Suspense>
            )}

            {/* Chevron Arrows */}
            {showArrows && !isRacingKit && chevronTransforms.length > 0 && (
                <instancedMesh ref={chevronsRef} args={[chevronGeometry, undefined, chevronTransforms.length]} frustumCulled={false}>
                    <primitive object={chevronMaterial} attach="material" />
                </instancedMesh>
            )}

            {/* Start/Finish Arch */}
            {!isRacingKit && (
                <StartFinishArch
                    position={startLine.position}
                    rotation={startLine.rotation}
                    trackWidth={trackWidth}
                    barrierColor={barrierColors[0]}
                />
            )}
        </group>
    );
}

// ── Shared Visual Logic (TrackMeshes, ProceduralDecor) from original Track.tsx ──

function TrackMeshes({
    trackWidth, curve, trackColor, barrierColors, hasCustomPath, textureUrl, textureScale, textureCrop,
}: {
    trackWidth: number;
    curve: THREE.CatmullRomCurve3;
    trackColor: string;
    barrierColors: [string, string];
    hasCustomPath: boolean;
    textureUrl?: string;
    textureScale?: number;
    textureCrop?: number;
}) {
    const trackTexture = textureUrl ? useTexture(textureUrl) : null;

    if (trackTexture) {
        trackTexture.wrapS = THREE.RepeatWrapping;
        trackTexture.wrapT = THREE.ClampToEdgeWrapping;
        trackTexture.anisotropy = 16;
        trackTexture.minFilter = THREE.LinearMipMapLinearFilter;
        trackTexture.magFilter = THREE.LinearFilter;
        trackTexture.needsUpdate = true;
    }

    const { trackGeo, wallsGeo } = useMemo(() => {
        let points = cleanPoints(curve.getSpacedPoints(hasCustomPath ? MESH_SAMPLES_CUSTOM : MESH_SAMPLES_DEFAULT));
        if (points.length > 2 && points[points.length - 1].distanceTo(points[0]) < 0.1) {
            points.pop();
        }

        const segments = points.length;
        const halfWidth = trackWidth / 2;
        const yOffset = 0.05;
        const up = new THREE.Vector3(0, 1, 0);
        const baseColor = new THREE.Color(trackColor);
        const stripeColor = new THREE.Color(1, 1, 1);
        const blendColor = new THREE.Color().lerpColors(stripeColor, baseColor, 0.25);

        const edgeOuter = halfWidth;
        const edgeInner = halfWidth - EDGE_STRIPE_WIDTH;
        const blendInner = halfWidth - EDGE_STRIPE_WIDTH - EDGE_BLEND_EXTRA;

        const VERTS_PER_ROW = 6;
        const trackPos: number[] = [];
        const trackNormals: number[] = [];
        const trackIndices: number[] = [];
        const trackColors: number[] = [];
        const trackUVs: number[] = [];

        let totalDistance = 0;

        const offsets = [-edgeOuter, -edgeInner, -blendInner, blendInner, edgeInner, edgeOuter];
        const totalWidth = edgeOuter * 2;
        const colors = [stripeColor, stripeColor, blendColor, blendColor, stripeColor, stripeColor];

        for (let i = 0; i <= segments; i++) {
            const pi = i % segments;
            const p = points[pi];
            const nextP = points[(pi + 1) % segments];

            const tangent = new THREE.Vector3().subVectors(nextP, p);
            if (tangent.lengthSq() < 0.00000001) tangent.set(0, 0, 1);
            tangent.normalize();

            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

            for (let v = 0; v < VERTS_PER_ROW; v++) {
                const vx = p.x + right.x * offsets[v];
                const vz = p.z + right.z * offsets[v];
                trackPos.push(vx, p.y + yOffset, vz);
                trackNormals.push(0, 1, 0);

                const c = v === 2 || v === 3 ? baseColor : colors[v];
                trackColors.push(c.r, c.g, c.b);

                const u = totalDistance * (textureScale ?? 0.1);
                const percentWidth = (offsets[v] + edgeOuter) / totalWidth;
                const crop = textureCrop ?? 0;
                const vCoord = crop + percentWidth * (1 - crop * 2);

                trackUVs.push(u, vCoord);
            }

            if (i < segments) {
                totalDistance += p.distanceTo(nextP);
            }
        }

        for (let i = 0; i < segments; i++) {
            const base = i * VERTS_PER_ROW;
            const nextBase = (i + 1) * VERTS_PER_ROW;

            for (let q = 0; q < VERTS_PER_ROW - 1; q++) {
                trackIndices.push(base + q, base + q + 1, nextBase + q);
                trackIndices.push(nextBase + q, base + q + 1, nextBase + q + 1);
            }
        }

        const wallPos: number[] = [];
        const wallIndices: number[] = [];
        const wallNormals: number[] = [];
        const wallColors: number[] = [];

        for (let i = 0; i < segments; i++) {
            const p = points[i];
            const nextP = points[(i + 1) % segments];

            const tangent = new THREE.Vector3().subVectors(nextP, p);
            if (tangent.lengthSq() < 0.00000001) tangent.set(0, 0, 1);
            tangent.normalize();

            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
            const nextP2 = points[(i + 2) % segments];
            const nextTangent = new THREE.Vector3().subVectors(nextP2, nextP).normalize();
            if (nextTangent.lengthSq() < 0.000001) nextTangent.copy(tangent);
            const nextRight = new THREE.Vector3().crossVectors(nextTangent, up).normalize();

            const wallColorObj = (Math.floor(i / WALL_COLOR_BAND_SIZE) % 2 === 0)
                ? new THREE.Color(barrierColors[0])
                : new THREE.Color(barrierColors[1]);

            const wLI = new THREE.Vector3().copy(p).addScaledVector(right, -halfWidth);
            const wLO = new THREE.Vector3().copy(p).addScaledVector(right, -(halfWidth + WALL_THICKNESS));
            const wRI = new THREE.Vector3().copy(p).addScaledVector(right, halfWidth);
            const wRO = new THREE.Vector3().copy(p).addScaledVector(right, halfWidth + WALL_THICKNESS);

            const nLI = new THREE.Vector3().copy(nextP).addScaledVector(nextRight, -halfWidth);
            const nLO = new THREE.Vector3().copy(nextP).addScaledVector(nextRight, -(halfWidth + WALL_THICKNESS));
            const nRI = new THREE.Vector3().copy(nextP).addScaledVector(nextRight, halfWidth);
            const nRO = new THREE.Vector3().copy(nextP).addScaledVector(nextRight, halfWidth + WALL_THICKNESS);

            const idxBase = wallPos.length / 3;

            wallPos.push(
                wLI.x, yOffset, wLI.z, wLI.x, WALL_HEIGHT, wLI.z,
                wLO.x, WALL_HEIGHT, wLO.z, wLO.x, yOffset, wLO.z,
                nLI.x, yOffset, nLI.z, nLI.x, WALL_HEIGHT, nLI.z,
                nLO.x, WALL_HEIGHT, nLO.z, nLO.x, yOffset, nLO.z,
            );
            wallPos.push(
                wRI.x, yOffset, wRI.z, wRI.x, WALL_HEIGHT, wRI.z,
                wRO.x, WALL_HEIGHT, wRO.z, wRO.x, yOffset, wRO.z,
                nRI.x, yOffset, nRI.z, nRI.x, WALL_HEIGHT, nRI.z,
                nRO.x, WALL_HEIGHT, nRO.z, nRO.x, yOffset, nRO.z,
            );

            for (let k = 0; k < 16; k++) {
                wallColors.push(wallColorObj.r, wallColorObj.g, wallColorObj.b);
                wallNormals.push(0, 1, 0);
            }

            wallIndices.push(idxBase + 0, idxBase + 4, idxBase + 1);
            wallIndices.push(idxBase + 4, idxBase + 5, idxBase + 1);
            wallIndices.push(idxBase + 1, idxBase + 5, idxBase + 2);
            wallIndices.push(idxBase + 5, idxBase + 6, idxBase + 2);
            wallIndices.push(idxBase + 2, idxBase + 6, idxBase + 3);
            wallIndices.push(idxBase + 6, idxBase + 7, idxBase + 3);

            wallIndices.push(idxBase + 8, idxBase + 9, idxBase + 12);
            wallIndices.push(idxBase + 12, idxBase + 9, idxBase + 13);
            wallIndices.push(idxBase + 9, idxBase + 13, idxBase + 10);
            wallIndices.push(idxBase + 13, idxBase + 14, idxBase + 10);
            wallIndices.push(idxBase + 10, idxBase + 14, idxBase + 11);
            wallIndices.push(idxBase + 14, idxBase + 15, idxBase + 11);
        }

        const trackGeo = new THREE.BufferGeometry();
        trackGeo.setAttribute("position", new THREE.Float32BufferAttribute(trackPos, 3));
        trackGeo.setAttribute("normal", new THREE.Float32BufferAttribute(trackNormals, 3));
        trackGeo.setAttribute("color", new THREE.Float32BufferAttribute(trackColors, 3));
        trackGeo.setAttribute("uv", new THREE.Float32BufferAttribute(trackUVs, 2));
        trackGeo.setIndex(trackIndices);
        trackGeo.computeVertexNormals();

        const wallsGeo = new THREE.BufferGeometry();
        wallsGeo.setAttribute("position", new THREE.Float32BufferAttribute(wallPos, 3));
        wallsGeo.setAttribute("color", new THREE.Float32BufferAttribute(wallColors, 3));
        wallsGeo.setAttribute("normal", new THREE.Float32BufferAttribute(wallNormals, 3));
        wallsGeo.setIndex(wallIndices);
        wallsGeo.computeVertexNormals();

        return { trackGeo, wallsGeo };
    }, [curve, trackWidth, trackColor, barrierColors, hasCustomPath, textureUrl, textureScale, textureCrop]);

    return (
        <group>
            <mesh geometry={trackGeo} receiveShadow>
                {trackTexture ? (
                    <meshStandardMaterial
                        map={trackTexture}
                        roughness={0.7}
                        metalness={0.05}
                    />
                ) : (
                    <meshStandardMaterial vertexColors roughness={0.7} metalness={0.05} />
                )}
            </mesh>
            <mesh geometry={wallsGeo} castShadow receiveShadow>
                <meshStandardMaterial
                    vertexColors
                    roughness={0.4}
                    metalness={0.3}
                    emissive="#ffffff"
                    emissiveIntensity={0.15}
                />
            </mesh>
        </group>
    );
}

function ProceduralDecor({
    type, sampledTrack, trackWidth, seed,
}: {
    type: string;
    sampledTrack: THREE.Vector3[];
    trackWidth: number;
    seed: string;
}) {
    const items = useMemo(() => {
        const result: { position: [number, number, number]; rotation: [number, number, number]; scale: number; variant: number }[] = [];
        if (sampledTrack.length < 2) return result;

        const rand = mulberry32(hashSeed(seed));
        const baseOffset = trackWidth / 2 + 5;
        const dir = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const pos = new THREE.Vector3();

        for (let i = 0; i < sampledTrack.length; i += 5) {
            if (rand() > 0.4) continue;

            const p = sampledTrack[i];
            const n = sampledTrack[(i + 1) % sampledTrack.length];
            if (!p || !n) continue;

            dir.subVectors(n, p).normalize();
            normal.set(-dir.z, 0, dir.x);

            for (const side of [-1, 1]) {
                if (rand() < 0.5) continue;
                const outward = baseOffset + 5 + rand() * 15;
                pos.copy(p).addScaledVector(normal, side * outward);

                result.push({
                    position: [pos.x, 0, pos.z],
                    rotation: [0, rand() * Math.PI * 2, 0],
                    scale: (0.8 + rand() * 0.4) * PROP_RATIO,
                    variant: Math.floor(rand() * 3),
                });
            }
        }
        return result;
    }, [sampledTrack, trackWidth, seed, type]);

    switch (type) {
        case "desert":
            return (
                <group>
                    {items.map((item, i) => (
                        <group key={i} position={item.position} rotation={item.rotation} scale={[item.scale, item.scale, item.scale]}>
                            {item.variant === 0 ? (
                                <group>
                                    <mesh position={[0, 1.5, 0]} castShadow>
                                        <cylinderGeometry args={[0.3, 0.4, 3, 8]} />
                                        <meshStandardMaterial color="#2d5a27" />
                                    </mesh>
                                    <mesh position={[0.6, 2, 0]} rotation={[0, 0, Math.PI / 4]} castShadow>
                                        <cylinderGeometry args={[0.2, 0.25, 1.5, 8]} />
                                        <meshStandardMaterial color="#2d5a27" />
                                    </mesh>
                                    <mesh position={[-0.6, 1, 0]} rotation={[0, 0, -Math.PI / 4]} castShadow>
                                        <cylinderGeometry args={[0.2, 0.25, 1, 8]} />
                                        <meshStandardMaterial color="#2d5a27" />
                                    </mesh>
                                </group>
                            ) : item.variant === 1 ? (
                                <mesh position={[0, 0.5, 0]} scale={[1.5, 1, 1.5]} castShadow>
                                    <sphereGeometry args={[0.7, 8, 8]} />
                                    <meshStandardMaterial color="#8B4513" />
                                </mesh>
                            ) : (
                                <mesh position={[0, 0.5, 0]} castShadow>
                                    <sphereGeometry args={[0.6, 8, 8]} />
                                    <meshStandardMaterial color="#A0522D" />
                                </mesh>
                            )}
                        </group>
                    ))}
                </group>
            );

        case "snow":
            return (
                <group>
                    {items.map((item, i) => (
                        <group key={i} position={item.position} rotation={item.rotation} scale={[item.scale, item.scale, item.scale]}>
                            {item.variant === 0 || item.variant === 1 ? (
                                <group>
                                    <mesh position={[0, 1, 0]} castShadow>
                                        <cylinderGeometry args={[0.4, 0.6, 2, 8]} />
                                        <meshStandardMaterial color="#5c4033" />
                                    </mesh>
                                    <mesh position={[0, 3, 0]} castShadow>
                                        <coneGeometry args={[2.5, 4, 8]} />
                                        <meshStandardMaterial color="#1a472a" />
                                    </mesh>
                                    <mesh position={[0, 3.5, 0]} castShadow>
                                        <coneGeometry args={[2.3, 1.5, 8]} />
                                        <meshStandardMaterial color="#ffffff" />
                                    </mesh>
                                </group>
                            ) : (
                                <group>
                                    <mesh position={[0, 0.8, 0]} castShadow>
                                        <sphereGeometry args={[0.8]} />
                                        <meshStandardMaterial color="#ffffff" />
                                    </mesh>
                                    <mesh position={[0, 2, 0]} castShadow>
                                        <sphereGeometry args={[0.6]} />
                                        <meshStandardMaterial color="#ffffff" />
                                    </mesh>
                                    <mesh position={[0, 2.9, 0]} castShadow>
                                        <sphereGeometry args={[0.4]} />
                                        <meshStandardMaterial color="#ffffff" />
                                    </mesh>
                                </group>
                            )}
                        </group>
                    ))}
                </group>
            );

        case "city":
            return (
                <group>
                    {items.map((item, i) => {
                        const height = 10 + item.variant * 5;
                        return (
                            <group key={i} position={item.position} rotation={item.rotation}>
                                <mesh position={[0, height / 2, 0]} castShadow>
                                    <boxGeometry args={[6 * item.scale, height, 6 * item.scale]} />
                                    <meshStandardMaterial color={item.variant % 2 === 0 ? "#334155" : "#1e293b"} metalness={0.6} roughness={0.2} />
                                </mesh>
                                {Array.from({ length: 4 }).map((_, w) => (
                                    <mesh key={w} position={[3.01 * item.scale, 2 + w * 3, 2]}>
                                        <planeGeometry args={[1, 1.5]} />
                                        <meshStandardMaterial color="#fef08a" emissive="#fef08a" emissiveIntensity={0.8} />
                                    </mesh>
                                ))}
                            </group>
                        );
                    })}
                </group>
            );

        default:
            return null;
    }
}
