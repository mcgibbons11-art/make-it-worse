"use client";

import { Html } from "@react-three/drei";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { placementSurfaces, type PlacementSurface } from "@/lib/game/placement";
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

function SurfacePatch({
  surface,
  live,
  refused,
  held,
  grabRadius,
  grabRef,
  onSelect,
  onMove,
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
}) {
  const width = surface.maxX - surface.minX;
  const depth = surface.maxZ - surface.minZ;
  const x = (surface.minX + surface.maxX) / 2;
  const z = (surface.minZ + surface.maxZ) / 2;
  return (
    <group
      position={[x, surface.groundY + 0.055, z]}
      onPointerDown={(event) => {
        event.stopPropagation();
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
        // So a press that lands ON the trap records the gap between the cursor
        // and the trap's base and preserves it for the whole drag, which is what
        // "picking something up" means. A press on empty floor still places the
        // trap there, because that gesture is a click-to-place and moving to
        // the click is exactly what it asks for.
        if (held) {
          const dx = held[0] - event.point.x;
          const dz = held[2] - event.point.z;
          grabRef.current = Math.hypot(dx, dz) <= grabRadius ? [dx, dz] : [0, 0];
        } else {
          grabRef.current = [0, 0];
        }
        onMove(surface.id, event.point.x + grabRef.current[0], event.point.z + grabRef.current[1]);
      }}
      onPointerMove={(event) => {
        // No selected-surface check. Holding the button and sweeping across the
        // course is the whole gesture, and gating it on where the drag began is
        // exactly what made it stop at an invisible line.
        if (event.buttons !== 1) return;
        event.stopPropagation();
        onMove(surface.id, event.point.x + grabRef.current[0], event.point.z + grabRef.current[1]);
      }}
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
}: Props) {
  const surfaces = useMemo(() => placementSurfaces(track), [track]);
  // One ref for every patch, because a drag that crosses onto another surface
  // is still the same grab and has to keep the offset it started with.
  const grabRef = useRef<readonly [number, number]>([0, 0]);
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
