// `danger` is reserved: it marks the ground a hazard can reach and is used for
// nothing else, so the colour itself teaches "this hurts". Every other hue here
// appears on both walkable floor and props, which is why they cannot carry that
// meaning. Chosen for contrast rather than taste: 6.5:1 on the cream deck and
// 4.1:1 on the tan one, where coral #ff5c65 manages 2.9:1 and 1.8:1.
export const PALETTE = { ink: "#171a2b", cream: "#fff8e8", skyTop: "#79d5ff", skyBottom: "#d8f5ff", yellow: "#ffd84d", red: "#ff5c65", green: "#57dfa1", purple: "#8b72ff", blue: "#4b8dff", orange: "#ff9b4a", muted: "#6e7487", danger: "#b3123c", ghost: "#ff6fd8" } as const;
export const PLAYER_SPAWN = [0, 1.25, 1.2] as const;
export const EXIT_POSITION = [0, 1.5, 40.25] as const;
export const EXIT_SENSOR_SIZE = [2.2, 3, 0.7] as const;
export const KILL_PLANE_Y = -10;
export const ATTEMPT_LIMIT_MS = 60_000;
export const MAX_TRAPS = 20;
export const GRID_SIZE = 0.25;
// Jump tuning. `gravityScale`, `linearDamping`, `jumpVelocity` and `moveSpeed`
// are the four numbers track.ts solves for JUMP_HEIGHT and JUMP_DISTANCE, and
// isPlayableTrack refuses a course whose worst rise or gap exceeds 90% of them,
// so changing any of the four moves the gate every shared link is measured
// against. The runner stands 1.86u tall (2 * capsuleHalfHeight + 2 *
// capsuleRadius) and could not clear his own head at the old 7.4 / 2.2, which
// read as heavy; 11.3 / 3 clears it with a shorter time to apex than before.
//
// `jumpCutMultiplier` is the floor a released jump falls back to. It is set so
// the shortest possible hop still out-jumps the old fixed one in both height
// and carry, which is what keeps every authored course at least as passable as
// it was for a player who taps rather than holds.
//
// The apex and fall multipliers reshape the arc at runtime and are deliberately
// absent from the budget: lightening gravity near the apex only ever adds
// height and hang time, so the published budget stays a floor on what the
// runner can actually do rather than a promise the simulation has to keep.
//
// `stepAssistHeight` is the tallest ledge PlayerController lifts the runner
// over, and 0.45 is measured rather than chosen. A dynamic capsule rides an
// edge only while that edge sits below its bottom hemisphere's centre, which is
// exactly capsuleRadius off the floor, so 0.38u is the natural ceiling and
// anything above it is a wall. Surveyed across the whole segment catalogue,
// every riser a runner can walk into takes one of four heights: 0.40u, which is
// always accidental, and 0.50u, 0.80u and 0.90u, every one of which a segment
// authors on purpose and describes as a jump. The assist has to clear the first
// and none of the rest, and (0.40, 0.50) is the whole of the room available.
// tests/unit/movement-feel.test.ts pins that census, so a segment that authors a
// riser inside the band fails rather than quietly losing its mechanic.
export const PLAYER = { capsuleRadius: 0.38, capsuleHalfHeight: 0.55, mass: 1, gravityScale: 3, linearDamping: 0.45, angularDamping: 2.5, moveSpeed: 7.2, acceleration: 30, airControl: 0.35, jumpVelocity: 11.3, jumpCutMultiplier: 0.82, apexVelocityWindow: 2, apexGravityMultiplier: 0.6, fallGravityMultiplier: 1.45, coyoteTimeMs: 180, jumpBufferMs: 150, maxFallSpeed: 18, strongImpactThreshold: 9, stunImpactThreshold: 14, stepAssistHeight: 0.45 } as const;
