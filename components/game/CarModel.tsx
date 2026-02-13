"use client";

import { useMemo, useRef, useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ── Steering Constants ──────────────────────────────────────────────
const MAX_STEERING_ANGLE = 0.6; // ~35 degrees
const STEERING_LERP_SPEED = 10.0;

// ── Wheel detection keywords ────────────────────────────────────────
const WHEEL_KEYWORDS = ["wheel", "tire", "rim"];
const FRONT_KEYWORDS = ["front", "fl", "fr"];

// ── Per-model visual defaults ───────────────────────────────────────
type ModelDefaults = { scale: number; yOffset: number; zOffset: number; yawOffset?: number };

const MODEL_DEFAULTS: Record<string, ModelDefaults> = {
  "/assets/cars/kart/go_kart.glb": { scale: 0.025, yOffset: 0.0, zOffset: 0 },
  "/assets/cars/rally.glb": { scale: 0.6, yOffset: 0.08, zOffset: 0 },
  "/assets/cars/coupe.glb": { scale: 0.62, yOffset: 0.08, zOffset: 0 },
  "/assets/cars/jeep.glb": { scale: 0.6, yOffset: 0.1, zOffset: 0 },
  "/assets/cars/kamaro.glb": { scale: 0.6, yOffset: 0.08, zOffset: 0 },
  "/assets/cars/police.glb": { scale: 0.6, yOffset: 0.08, zOffset: 0 },
  "/assets/cars/van.glb": { scale: 0.6, yOffset: 0.1, zOffset: 0 },
  "/assets/cars/designersoup-glb/Beatall.glb": { scale: 0.55, yOffset: 0.06, zOffset: 0, yawOffset: Math.PI / 2 },
  "/assets/cars/designersoup-glb/docLorean.glb": { scale: 0.55, yOffset: 0.06, zOffset: 0, yawOffset: Math.PI / 2 },
  "/assets/cars/designersoup-glb/Landyroamer.glb": { scale: 0.55, yOffset: 0.08, zOffset: 0, yawOffset: Math.PI / 2 },
  "/assets/cars/designersoup-glb/Toyoyo%20Highlight.glb": { scale: 0.55, yOffset: 0.06, zOffset: 0, yawOffset: Math.PI / 2 },
  "/assets/cars/designersoup-glb/Tristar%20Racer.glb": { scale: 0.55, yOffset: 0.06, zOffset: 0, yawOffset: Math.PI / 2 },
  "/assets/cars/styloo/carblack.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/carblue.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/cargreen.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/cargreenvariant1.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/cargreenvariant2.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/carred.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/carwhite.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/caryellow.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
  "/assets/cars/styloo/caryellowvariant.glb": { scale: 0.6, yOffset: 0.35, zOffset: 0, yawOffset: -Math.PI / 2 },
};

const FALLBACK_DEFAULTS: ModelDefaults = { scale: 0.6, yOffset: 0.08, zOffset: 0, yawOffset: 0 };

// ── Types ───────────────────────────────────────────────────────────
type CarModelProps = {
  url: string;
  scale?: number;
  yOffset?: number;
  zOffset?: number;
  yawOffset?: number;
  steeringRef?: React.MutableRefObject<number>;
  color?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────

function isWheelObject(name: string): boolean {
  const lower = name.toLowerCase();
  return WHEEL_KEYWORDS.some((kw) => lower.includes(kw));
}

function isFrontWheel(name: string): boolean {
  const lower = name.toLowerCase();
  return FRONT_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Detect front wheels from the scene hierarchy. */
function detectFrontWheels(scene: THREE.Object3D, yawOffset: number): THREE.Object3D[] {
  const wheels: { obj: THREE.Object3D; z: number; x: number }[] = [];

  scene.traverse((obj) => {
    if (!isWheelObject(obj.name)) return;

    // Accept both Mesh nodes and Group/Object3D parents of meshes
    const isMesh = (obj as THREE.Mesh).isMesh;
    const hasChildMesh = obj.children.some((c) => (c as THREE.Mesh).isMesh);
    if (!isMesh && !hasChildMesh) return;

    wheels.push({ obj, z: obj.position.z, x: obj.position.x });
  });

  if (wheels.length === 0) return [];

  // Prefer explicitly named front wheels
  const namedFront = wheels.filter((w) => isFrontWheel(w.obj.name));
  if (namedFront.length >= 2) return namedFront.map((w) => w.obj);

  // Fallback: sort by forward axis and take the 2 most forward
  const isXForward = Math.abs(Math.abs(yawOffset) - Math.PI / 2) < 0.1;
  wheels.sort((a, b) => (isXForward ? b.x - a.x : b.z - a.z));

  return wheels.slice(0, 2).map((w) => w.obj);
}

// ── CarModel Component ──────────────────────────────────────────────

export function CarModel({ url, scale, yOffset, zOffset, yawOffset, steeringRef, color }: CarModelProps) {
  const gltf = useGLTF(url);

  const defaults = MODEL_DEFAULTS[url] ?? FALLBACK_DEFAULTS;
  const resolvedScale = scale ?? defaults.scale;
  const resolvedYOffset = yOffset ?? defaults.yOffset;
  const resolvedZOffset = zOffset ?? defaults.zOffset;
  const resolvedYaw = yawOffset ?? defaults.yawOffset ?? 0;

  const frontWheelsRef = useRef<THREE.Object3D[]>([]);
  const initialRotationsRef = useRef<Map<string, THREE.Euler>>(new Map());
  const currentSteering = useRef(0);

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;

        // Apply team color if available
        if (color && (obj.name.toLowerCase().includes("body") || obj.name.toLowerCase().includes("chassis"))) {
          const mesh = obj as THREE.Mesh;
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (mat) {
            const newMat = mat.clone();
            if ('color' in newMat) {
              (newMat as THREE.MeshStandardMaterial).color.set(color);
            }
            mesh.material = newMat;
          }
        }
      }
    });
    return cloned;
  }, [gltf.scene, color]);

  // Detect and cache front wheels
  useEffect(() => {
    frontWheelsRef.current = [];
    initialRotationsRef.current.clear();

    const frontWheels = detectFrontWheels(scene, resolvedYaw);
    frontWheels.forEach((w) => {
      initialRotationsRef.current.set(w.uuid, w.rotation.clone());
      frontWheelsRef.current.push(w);
    });
  }, [scene, resolvedYaw]);

  // Dispose cloned scene on unmount to free GPU memory
  useEffect(() => {
    return () => {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            if ((m as THREE.MeshStandardMaterial).map) (m as THREE.MeshStandardMaterial).map!.dispose();
            m.dispose();
          });
        }
      });
    };
  }, [scene]);

  // Animate steering every frame
  useFrame((_state, delta) => {
    if (!steeringRef || frontWheelsRef.current.length === 0) return;

    const lerpFactor = STEERING_LERP_SPEED * delta;
    currentSteering.current = THREE.MathUtils.lerp(currentSteering.current, steeringRef.current, lerpFactor);

    const steerAngle = -currentSteering.current * MAX_STEERING_ANGLE;

    frontWheelsRef.current.forEach((wheel) => {
      const initial = initialRotationsRef.current.get(wheel.uuid);
      if (!initial) return;
      wheel.rotation.set(initial.x, initial.y + steerAngle, initial.z);
    });
  });

  return (
    <group
      scale={resolvedScale}
      position={[0, resolvedYOffset, resolvedZOffset]}
      rotation={[0, resolvedYaw, 0]}
    >
      <primitive object={scene} />
      {url.includes("go_kart.glb") && (
        <DriverModel url="/assets/person/nickelodeon_kart_racers_3_spongebob.glb" />
      )}
    </group>
  );
}

// ── DriverModel (SpongeBob overlay for go_kart) ─────────────────────

function DriverModel({ url }: { url: string }) {
  const gltf = useGLTF(url);

  const scene = useMemo(() => {
    const clone = gltf.scene.clone();
    clone.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });
    return clone;
  }, [gltf.scene]);

  return (
    <primitive
      object={scene}
      position={[0, 4, 0]}
      scale={40}
      rotation={[0, 0, 0]}
    />
  );
}
