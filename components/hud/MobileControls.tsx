"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { queueJumpPress, setKey, setMobileMove } from "@/lib/game/input";

/** The capability gate promised by the Portals mobile brief. */
export function supportsTouchControls(scope: object): boolean {
  return "ontouchstart" in scope;
}

/**
 * Starts false so the Next shell hydrates the same markup it rendered on the
 * server, then exposes the browser's real touch capability.
 */
export function useTouchControlsAvailable(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => supportsTouchControls(window),
    () => false,
  );
}

export function MobileControls() {
  const available = useTouchControlsAvailable();
  const pointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const jumpPointerQueued = useRef(false);

  const move = (event: React.PointerEvent) => {
    if (pointer.current !== event.pointerId) return;
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const radius = 44;
    const x = Math.abs(dx) < 6 ? 0 : dx / Math.max(radius, length);
    const y = Math.abs(dy) < 6 ? 0 : -dy / Math.max(radius, length);
    setKnob({ x: x * radius, y: -y * radius });
    setMobileMove(x, y);
  };
  const release = (event: React.PointerEvent) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    setMobileMove(0, 0);
  };

  if (!available) return null;
  return (
    <div className="mobile-controls is-touch" aria-label="Touch game controls">
      <div
        className="joystick"
        aria-label="Move"
        onPointerDown={(event) => {
          pointer.current = event.pointerId;
          origin.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <div className="mobile-actions">
        <button
          aria-label="Grab"
          onPointerDown={() => setKey("grab", true)}
          onPointerUp={() => setKey("grab", false)}
          onPointerCancel={() => setKey("grab", false)}
        >
          GRAB
        </button>
        <button
          className="jump"
          aria-label="Jump"
          onPointerDown={() => {
            jumpPointerQueued.current = true;
            setKey("jump", true);
          }}
          onPointerUp={() => setKey("jump", false)}
          onPointerCancel={() => setKey("jump", false)}
          onClick={() => {
            if (!jumpPointerQueued.current) queueJumpPress();
            jumpPointerQueued.current = false;
          }}
        >
          JUMP
        </button>
      </div>
    </div>
  );
}
