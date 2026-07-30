# Custom game sharing and trending path

## What works in this build

- Builder rooms have content-derived identities. Editing geometry creates a new version instead of overwriting an older shared room.
- Publish stores the room on this device and registers it in the main-menu Trending browser.
- Copy map link embeds the complete bounded room, spawn, finish, traps, and runner appearance in the game URL.
- Copy map code provides the same payload without relying on a host preserving query parameters.
- Trending accepts either a full link or a raw code. A recipient imports the authored geometry before the game opens.
- Authored geometry is persisted with the local challenge, inherited by child rounds, and restored after a repository/browser reload.
- The Next/Supabase edition has a real community-map API and browser. Publishing creates a stable owned map plus an immutable version; exact-version links load the stored self-contained code into the same local child-chain engine used by Portals.
- The builder publish form collects title, description, and public/unlisted/private visibility. The community browser provides search, Trending/New sorting, pagination, creator/version attribution, likes, shares, reports, owner management, rollback, and moderator controls.

## Portals SDK boundary

The documented Portals SDK provides identity, per-player saved state, scores, leaderboards, and quit. It does not expose a native invite-link API or a global user-content database. Portals multiplayer is session-scoped: `Portals.net` connects players who are already on the same game page or in the same room. Hosted games also cannot call an arbitrary external API, WebSocket, WebRTC endpoint, or analytics host.

Relevant official documentation:

- https://portals.to/documentation/advanced-tooling/portals-sdk
- https://portals.to/documentation/advanced-tooling/multiplayer-and-voice

Consequences:

1. A self-contained challenge code is the reliable cross-session handoff available to the current static game.
2. `Portals.net` can announce a code to players already in one Portals session, but it cannot create the invitation that gets them there.
3. A truly global persistent map browser requires Portals to provide platform storage/moderation APIs or approve a same-origin backend. It cannot be implemented honestly with localStorage or per-player `saveState` alone.

## Same-session Portals path

The static build now feature-detects `Portals.net` and uses a small session protocol rather than sending arbitrary game state every frame:

- `map-announcement`: map id, version id, author, title, compact challenge code, published timestamp.
- `map-request`: version id requested by a late joiner.
- `map-response`: compact code when it fits in the documented 8 KB message ceiling.
- Shared state holds the latest announcement so a late joiner in the same session can discover it.
- Reject unknown message versions, oversized payloads, invalid map schemas, and codes whose decoded geometry exceeds the builder bounds.
- Publishing writes the announcement to shared state and broadcasts it. Receiving players validate and import it into their local Trending browser without automatically replacing their active run.
- The feature is inert outside a processed Portals host, so localhost and downloaded bundles retain the same self-contained link/code behavior.

The raw code remains visible/copyable when a map exceeds the session message ceiling or the multiplayer transport is unavailable.

## Global backend path

The backend path is implemented by `supabase/migrations/0021_custom_map_publishing.sql`, `/api/maps/**`, and the `/maps` browser in the Next edition. It becomes operational when the repository is connected to a Supabase project and all migrations are applied. With Supabase variables blank, `/maps` explicitly says the global backend is not connected and never presents IndexedDB data as global.

The preferred backend model is immutable versions under a stable map identity:

- `maps`: id, owner player id, current version id, title, description, visibility, moderation status, created/updated timestamps.
- `map_versions`: id, map id, version number, schema version, compact payload, payload hash, piece/trap counts, playable verdict, created timestamp.
- `map_events`: version id, anonymous/player id, impression, start, clear, fail, like, share, report, timestamp.
- `map_reports`: reporter, reason, optional note, status, moderator decision.

Publishing validates the payload server-side, creates an immutable version, and atomically points the map at it. Updating never mutates a version already used by a shared link or child chain.

The database independently base64url-decodes the version-5 envelope, verifies its slug and bounded piece/trap counts, computes its SHA-256 hash itself, rejects stale optimistic updates, and keeps all tables behind SECURITY DEFINER RPCs. Direct table access is revoked. Old versions remain loadable, measurable, and reportable by exact link after later publishes or rollbacks.

Trending should rank eligible maps with a time-decayed score, for example:

`recent unique starts + 3×clears + 5×likes + 4×shares - 8×reports`

Apply Wilson/Bayesian smoothing, author diversity, a minimum-impression gate, and a freshness decay so one old map cannot permanently own the page. Exclude private, rejected, quarantined, invalid, and incompatible-schema versions before ranking.

That ranking is now implemented with unique per-player/version events, a five-impression confidence gate, smoothed clear quality, seven-day exponential decay, report penalties, and a maximum of two results per creator in public browse results. Three unique open reports automatically quarantine a map until a moderator restores or rejects it.

## Release test matrix

- Build, publish, update, and verify the old link still opens the old immutable version.
- Open link as a different player/session and compare every piece, zone, endpoint, trap, and color.
- Import raw code when query parameters are stripped.
- Finish the imported room, place a trap, play the child, and place a second trap without geometry changing.
- Reopen after a browser restart and repeat the child flow.
- Exercise 1 byte below, exactly at, and 1 byte above link/message/backend limits.
- Corrupt, truncate, duplicate, and replay payloads; show recoverable errors without losing the local draft.
- Join a Portals room before and after publish; verify both existing players and late joiners receive the announcement.
- Verify unlisted/private maps never appear in Trending, and reported/quarantined maps disappear.
- Load-test browse pagination and trending recomputation, then test rollback to the previous map version.

Current verification: unit tests cover malformed/oversized messages, late-join state, broadcast announcements, request/response, API validation, pagination cursors, immutable-version RPC routing, ranking weights/decay, visibility/security SQL, browse/play UI, owner rollback, and reporting. An end-to-end repository test covers two different player databases, browser restart, two complete child rounds, old-link immutability, corruption, and the payload ceiling. Browser production smoke covers builder publishing, all visibility choices, copied authored-room links, reload into the 3D game, and the honest no-backend fallback. A two-browser SDK-host simulation covers publish to session state and late-join import into Trending.

Two release gates require external state that is not present in this workspace: apply migration 0021 to an approved Supabase project and exercise the API against that real database; upload the static bundle to a processed Portals preview and open two players in one real session. Portals cannot use the Supabase browser itself unless Portals approves that network path, so the static edition continues to use session relay plus self-contained codes.

### Real Supabase release command

Once the deployment and two test users exist, make the second user a moderator in `public.profiles`, provide short-lived ordinary user access tokens, and run:

```powershell
$env:CUSTOM_MAP_TEST_BASE_URL='https://your-deployment.example'
$env:CUSTOM_MAP_TEST_OWNER_TOKEN='<owner access token>'
$env:CUSTOM_MAP_TEST_PLAYER_TOKEN='<different player access token>'
$env:CUSTOM_MAP_TEST_MODERATOR_TOKEN='<player/moderator access token>'
pnpm verify:custom-maps
```

The command never accepts or needs the service-role key. It creates one uniquely named test map, verifies publish replay, Trending search, exact recipient loading, unique events, reporting, a second immutable version, stale-write conflict, old-version loading, rollback, unlisted/private access, moderator quarantine/restore, and owner-only browsing. It leaves the synthetic map private so it cannot pollute Trending while preserving the audit trail.
