# MAKE IT WORSE release report

Build date: 2026-07-26
Release target: desktop browser, with a self-contained static edition for Portals

## Verified stack

- Next.js 16.2.12, React 19.2.4, Three.js 0.185.1
- React Three Fiber 9.6.1, Drei 10.7.7, React Three Rapier 2.2.0
- Vite 7.1.7 for the `portals/` static build
- Playwright 1.62.0 and Vitest 4.1.10

## Release gates

- `pnpm check`: PASS
  - ESLint: zero warnings
  - strict TypeScript: PASS
  - Vitest: 9 files, 23 tests passed
  - optimized Next.js production build: PASS
- `node scripts/run-e2e.mjs --workers=1`: PASS
  - 21/21 production browser tests passed
  - Chromium full loop, failure retry, real keyboard movement and course clear,
    seven licensed GLBs plus the authored vacuum, all-hazard sandbox with real
    grab/release shove, real touch activation, desktop and mobile hierarchy,
    actual snapped editor pointer placement, every trap's production physics
    mechanic, and a controlled 4x CPU-throttle test
  - Firefox and WebKit each cleared the clean WebGL/Rapier course using real
    keyboard input, in addition to home/privacy/health smoke tests
- `pnpm build` from `portals/`: PASS
  - output: `portals/dist`
  - relative entry and asset paths
  - no required Supabase, API, analytics, font, or CDN runtime dependency
- Cold-cache Portals asset gate: PASS
  - start remains disabled until all seven GLBs have decoded
- Local Portals desktop browser audit: PASS
  - no failed network responses or page errors

## Asset and licensing verification

Seven game props are modified CC BY 4.0 Sketchfab downloads. Blender 4.5 was
used to normalize scale and ground origins; authored Rapier primitives provide
gameplay colliders. The angry vacuum, player, environment, interface, shaders,
and effects are original project work. Creator links and SHA-256 hashes are in
`public/assets/models/LICENSES.md`. No recognizable branded vacuum is present
in public or built runtime artifacts.

## Portals import settings

- Project directory: `portals`
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm build`
- Output directory: `dist`
- Branch: `main`

Suggested listing:

- Title: `MAKE IT WORSE — Portals Edition`
- Description: `Desktop-only browser obstacle game. Beat the apartment run,
  add one trap, and replay the locally saved consequence. Chains stay in this
  browser; this Portals edition does not create cross-device links.`
- Controls: `WASD or arrows · Space jump · E grab/release shove · R reset`

## Deliberate limitations

- Portals is the desktop-browser target. The Portals edition does not claim
  native mobile support.
- Portals challenge chains are stored in that browser's IndexedDB. They are not
  cross-device links.
- The full Next.js/Supabase edition requires migrations `0001` through `0007`
  to be applied and exercised against the deployment's Supabase project before
  that separate hosted service is released.
- Attempt completion is client-authoritative. The project validates payload
  shape and plausibility but does not claim hostile cheat resistance.
