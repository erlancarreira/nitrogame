"use client";

import { useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface FollowCameraProps {
  targetRef?: RefObject<{
    position: [number, number, number];
    rotation: number;
  }>;
  targetRotation?: number;
  cameraDistance?: number;
  cameraHeight?: number;
  speedRef?: RefObject<number>;
  effectsRef?: RefObject<{ isDrifting: boolean; isBoosting: boolean }>;
}

export function FollowCamera({
  targetRef,
  cameraDistance = 5,
  cameraHeight = 2,
}: FollowCameraProps) {
  const camera = useThree((state) => state.camera);
  const currentPos = useRef(new THREE.Vector3());
  const currentLook = useRef(new THREE.Vector3());
  const smoothRotation = useRef(0);
  const smoothX = useRef(0);
  const smoothZ = useRef(0);
  const smoothY = useRef(0);
  const initialized = useRef(false);
  const _targetPos = useRef(new THREE.Vector3());
  const _targetLook = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    if (!targetRef?.current) return;

    const { position, rotation } = targetRef.current;

    // Fallback NaN protection
    if (!position || isNaN(position[0])) return;

    // First frame — snap everything, no lerp
    if (!initialized.current) {
      smoothX.current = position[0];
      smoothY.current = position[1];
      smoothZ.current = position[2];
      smoothRotation.current = rotation;

      const dist = 10;
      const height = 5;
      const tx = position[0] - Math.sin(rotation) * dist;
      const tz = position[2] - Math.cos(rotation) * dist;
      const ty = position[1] + height;

      currentPos.current.set(tx, ty, tz);
      currentLook.current.set(position[0], position[1] + 2, position[2]);
      initialized.current = true;
    }

    // Smooth all axes independently — Y gets much heavier damping to kill vertical jitter
    const xyAlpha = 1 - Math.exp(-8.0 * delta);
    const yAlpha = 1 - Math.exp(-1.5 * delta);

    smoothX.current += (position[0] - smoothX.current) * xyAlpha;
    smoothZ.current += (position[2] - smoothZ.current) * xyAlpha;
    smoothY.current += (position[1] - smoothY.current) * yAlpha;

    smoothRotation.current = THREE.MathUtils.lerp(
      smoothRotation.current,
      rotation,
      1 - Math.exp(-7 * delta)
    );

    // TARGETS — all computed from smoothed values
    const dist = 10;
    const height = 5;

    const tx = smoothX.current - Math.sin(smoothRotation.current) * dist;
    const tz = smoothZ.current - Math.cos(smoothRotation.current) * dist;
    const ty = smoothY.current + height;

    const lx = smoothX.current;
    const ly = smoothY.current + 2;
    const lz = smoothZ.current;

    // Camera position lerp — smooth final output
    const camAlpha = 1 - Math.exp(-5.0 * delta);

    _targetPos.current.set(tx, ty, tz);
    _targetLook.current.set(lx, ly, lz);
    currentPos.current.lerp(_targetPos.current, camAlpha);
    currentLook.current.lerp(_targetLook.current, camAlpha);

    // SAFETY CHECK
    if (isNaN(currentPos.current.x) || isNaN(currentLook.current.x)) {
      currentPos.current.set(tx, ty, tz);
      currentLook.current.set(lx, ly, lz);
    }

    camera.position.copy(currentPos.current);
    camera.lookAt(currentLook.current);
  });

  return null;
}
