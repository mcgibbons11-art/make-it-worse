"use client";

import { Html } from "@react-three/drei";
import { PLACEMENT_ZONES, zoneCenter } from "@/lib/game/level-definition";
import type { TrapInstance } from "@/lib/game/types";

interface Props {
  selectedZoneId: string | null;
  traps: readonly TrapInstance[];
  onSelect(id: string): void;
  onMove(id: string, worldX: number, worldZ: number): void;
}

export function PlacementZones({
  selectedZoneId,
  traps,
  onSelect,
  onMove,
}: Props) {
  return (
    <>
      {PLACEMENT_ZONES.map((zone) => {
        const [x, z] = zoneCenter(zone);
        const selected = zone.id === selectedZoneId;
        const occupied = traps.filter((trap) => trap.zoneId === zone.id).length;
        return (
          <group
            key={zone.id}
            position={[x, zone.groundY + 0.055, z]}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(zone.id);
              onMove(zone.id, event.point.x, event.point.z);
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1 || zone.id !== selectedZoneId) return;
              event.stopPropagation();
              onMove(zone.id, event.point.x, event.point.z);
            }}
          >
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry
                args={[zone.maxX - zone.minX, zone.maxZ - zone.minZ]}
              />
              <meshBasicMaterial
                color={selected ? "#57dfa1" : "#fff8e8"}
                transparent
                opacity={selected ? 0.2 : 0.1}
                depthWrite={false}
              />
            </mesh>
            {selected && (
              <>
                <Html position={[0, 2.35, 0]} center style={{ pointerEvents: "none" }}>
                  <span className="zone-label">
                    {zone.label} · drag to place · {occupied}/{zone.maxOccupants}
                  </span>
                </Html>
                {process.env.NEXT_PUBLIC_E2E_TEST_MODE === "1" && (
                  <Html position={[0, 0.04, 0]} center style={{ pointerEvents: "none" }}>
                    <span
                      data-testid="selected-zone-anchor"
                      style={{ display: "block", width: 2, height: 2, opacity: 0 }}
                    />
                  </Html>
                )}
              </>
            )}
          </group>
        );
      })}
    </>
  );
}
