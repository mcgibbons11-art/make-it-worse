"use client";

import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import {
  placementGrabOffset,
  placementSurfaces,
  type PlacementSurface,
} from "@/lib/game/placement";
import type { BuiltTrack } from "@/lib/game/track";
import type { TrapInstance } from "@/lib/game/types";

interface Props {
  selectedZoneId: string | null;
  traps: readonly TrapInstance[];
  /** The challenge's own course, so every piece of it is placeable. */
  track: BuiltTrack;
  /** Why the spot under the cursor is refused, or null while it is fine. */
  refusal: string | null;
  /** Where the dragged trap stands right now, so a press on it grabs it. */
  held: readonly [number, number, number] | null;
  /** The trap's own footprint radius: how close a press counts as "on it". */
  heldRadius: number;
  onSelect(id: string): void;
  onMove(id: string, worldX: number, worldZ: number): void;
  onDragActiveChange(active: boolean): void;
}

/**
 * The floor a trap may be dropped on, and the drag that puts it there.
 *
 * Two things made this feel janky, and both were structural rather than
 * cosmetic:
 *
 * 1. The drag died at a zone boundary. onPointerMove returned early unless the
 *    surface under the cursor was the one the drag STARTED on, so pulling a
 *    trap from the runway toward the bridge simply stopped moving halfway. Now
 *    any surface accepts the move and reports itself, so the drag is continuous
 *    across the whole course and the trap re-homes as it crosses.
 *
 * 2. You could not see where you were allowed to drop. Unselected zones drew as
 *    #fff8e8 at opacity 0.1 - cream on a cream deck, which is nothing - and only
 *    the selected one was labelled. At the single moment the player is authoring
 *    rather than reacting, the board was invisible. Every surface now carries an
 *    ink edge, which is the same device the platforms themselves use to stay
 *    legible against the sky.
 */
const EDGE = "#171a2b";
const FILL_IDLE = "#8b72ff";
const FILL_LIVE = "#57dfa1";
const FILL_REFUSED = "#ff5964";

type PointerCaptureTarget = EventTarget & {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
};

function SurfacePatch({
  surface,
  live,
  refused,
  held,
  grabRadius,
  grabRef,
  onSelect,
  onMove,
  onDragActiveChange,
}: {
  surface: PlacementSurface;
  live: boolean;
  refused: boolean;
  /** Where the dragged trap currently stands, so a press on it can be a grab. */
  held: readonly [number, number, number] | null;
  /** How close a press counts as landing on the trap rather than on the floor. */
  grabRadius: number;
  /** Shared across every patch: a drag that crosses surfaces keeps its offset. */
  grabRef: MutableRefObject<readonly [number, number]>;
  onSelect(id: string): void;
  onMove(id: string, worldX: number, worldZ: number): void;
  onDragActiveChange(active: boolean): void;
}) {
  const width = surface.maxX - surface.minX;
  const depth = surface.maxZ - surface.minZ;
  const x = (surface.minX + surface.maxX) / 2;
  const z = (surface.minZ + surface.maxZ) / 2;
  const dragY = surface.groundY + 0.105;
  const dragPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragY),
    [dragY],
  );
  const dragPoint = useMemo(() => new THREE.Vector3(), []);
  const activePointer = useRef<number | null>(null);
  const capturedTarget = useRef<PointerCaptureTarget | null>(null);

  const pointOnDeck = (event: ThreeEvent<PointerEvent>): THREE.Vector3 | null =>
    event.ray.intersectPlane(dragPlane, dragPoint);

  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    if (activePointer.current !== event.pointerId) return;
    event.stopPropagation();
    activePointer.current = null;
    onDragActiveChange(false);
    const target = capturedTarget.current;
    capturedTarget.current = null;
    if (target?.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };
  // The visible deck wash tops out at groundY + 0.075. The interaction plane
  // used to sit underneath it at +0.055, so the mouse struck the platform's
  // top/side seam before it struck the placeable surface. Lift the patch clear
  // of the artwork so the whole top face is one uninterrupted target.
  return (
    <group
      position={[x, dragY, z]}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const point = pointOnDeck(event);
        if (!point) return;
        activePointer.current = event.pointerId;
        onDragActiveChange(true);
        const target = event.target as PointerCaptureTarget | null;
        target?.setPointerCapture(event.pointerId);
        capturedTarget.current = target;
        onSelect(surface.id);
        // Grabbing the trap must not MOVE the trap.
        //
        // The pointer ray is intersected with the FLOOR, but the thing under
        // the cursor is the trap's body, which stands above it. Pressing on the
        // trap therefore reported a floor point offset by the parallax between
        // its body and its base - measured at 0.79u on a press that should have
        // moved nothing - so the trap teleported on mousedown and every drag
        // began in a refused state. That is the first thing a player feels.
        //
        // So a press very near the trap's centre records the gap between the
        // cursor and its base. The pickup handle is deliberately much smaller
        // than a large trap's hazard radius, leaving the rest of the platform
        // available for direct click-to-place.
        grabRef.current = placementGrabOffset(
          held,
          point.x,
          point.z,
          grabRadius,
        );
        onMove(surface.id, point.x + grabRef.current[0], point.z + grabRef.current[1]);
      }}
      onPointerMove={(event) => {
        // The patch that received pointer-down owns the drag until pointer-up.
        // R3F pointer capture keeps it receiving rays while the cursor is over
        // a gap, another platform, or the preview prop itself. Intersecting the
        // ray with a stable horizontal plane avoids using a box side/corner as
        // the world point, which was the remaining source of edge sticking.
        if (activePointer.current !== event.pointerId) return;
        event.stopPropagation();
        const point = pointOnDeck(event);
        if (!point) return;
        onMove(surface.id, point.x + grabRef.current[0], point.z + grabRef.current[1]);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color={refused && live ? FILL_REFUSED : live ? FILL_LIVE : FILL_IDLE}
          transparent
          opacity={live ? 0.26 : 0.12}
          depthWrite={false}
        />
      </mesh>
      {/* An outline rather than a wash. A filled rectangle at a readable
          opacity would hide the deck colour the player is aiming at; a line
          says "here" without repainting the floor. */}
      <lineSegments rotation={[-Math.PI / 2, 0, 0]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(width, depth)]} />
        <lineBasicMaterial color={EDGE} transparent opacity={live ? 0.9 : 0.4} />
      </lineSegments>
    </group>
  );
}

export function PlacementZones({
  selectedZoneId,
  traps,
  track,
  refusal,
  held,
  heldRadius,
  onSelect,
  onMove,
  onDragActiveChange,
}: Props) {
  const surfaces = useMemo(() => placementSurfaces(track), [track]);
  // One ref for every patch, because a drag that crosses onto another surface
  // is still the same grab and has to keep the offset it started with.
  const grabRef = useRef<readonly [number, number]>([0, 0]);
  useEffect(
    () => () => onDragActiveChange(false),
    [onDragActiveChange],
  );
  const selected = surfaces.find((surface) => surface.id === selectedZoneId) ?? null;
  return (
    <>
      {surfaces.map((surface) => (
        <SurfacePatch
          key={surface.id}
          surface={surface}
          live={surface.id === selectedZoneId}
          refused={refusal !== null}
          held={held}
          grabRadius={heldRadius}
          grabRef={grabRef}
          onSelect={onSelect}
          onMove={onMove}
          onDragActiveChange={onDragActiveChange}
        />
      ))}
      {selected && (
        <group
          position={[
            (selected.minX + selected.maxX) / 2,
            selected.groundY + 0.055,
            (selected.minZ + selected.maxZ) / 2,
          ]}
        >
          {/* The refusal is shown AT THE CURSOR while dragging rather than
              after committing, and in the player's language: "unsafe_sweep" is
              a developer string, "Not enough room to dodge this here" is the
              thing they need to know to move it somewhere better. */}
          <Html position={[0, 2.35, 0]} center style={{ pointerEvents: "none" }}>
            <span className={refusal ? "zone-label is-refused" : "zone-label"}>
              {refusal ?? `${traps.length} placed · drop it anywhere on the floor`}
            </span>
          </Html>
        </group>
      )}
      {held && process.env.NEXT_PUBLIC_E2E_TEST_MODE === "1" && (
        <Html
          position={[held[0], held[1] + 0.095, held[2]]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span
            data-testid="selected-zone-anchor"
            style={{ display: "block", width: 2, height: 2, opacity: 0 }}
          />
        </Html>
      )}
    </>
  );
}
