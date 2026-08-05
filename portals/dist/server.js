// Portals server script — PRESENCE PROBE ONLY.
//
// Portals runs this file as an invisible authoritative participant in every
// multiplayer session of this game, one instance per session, isolated by
// channel. Right now it referees NOTHING: Duel Mode's rules still live in
// portals/src/duel/duel-protocol.ts and run on the clients, exactly as they
// did before this file existed.
//
// It exists to answer one question that the documentation does not: whether a
// bundle delivered by GitHub sync gets its server script picked up at all. The
// docs describe server.js shipping "in your published bundle like every other
// project file", but they only walk through the editor upload workflow, and
// our game reaches Portals by syncing portals/dist from a repository. Until a
// real session reports this key, every plan that depends on server authority
// is built on an assumption.
//
// Deliberately inert, because it also joins the map-relay session that carries
// published map codes. It writes one state key and never touches gameplay, so
// the worst case if Portals runs it is a single unread key out of the 64 a
// session allows. The clients treat its absence as normal - which is also the
// documented requirement, since a script that crashes or exceeds its budget is
// dropped while the session plays on.
//
// Sandbox: no import/require, no DOM, no network. Timers come from the frozen
// `server` global. Keys prefixed `server:` are writable only from here, which
// is what would make a refereed match record unforgeable if we ever move the
// rules in.
//
// This file ships publicly in the bundle. Never put a secret in it.

var REFEREE_KEY = "server:referee";
// Bumped by hand when this file changes, so a client can tell a stale server
// (Portals swaps running servers a few seconds after a publish) from a fresh
// one without guessing from timestamps.
var REFEREE_BUILD = 1;

function publishPresence() {
  server.setState(REFEREE_KEY, {
    build: REFEREE_BUILD,
    // Proof of life rather than a clock the clients should trust: turn
    // deadlines still come from the match record.
    players: server.players().length,
    at: Date.now(),
  });
}

publishPresence();
server.on("playerjoin", publishPresence);
server.on("playerleave", publishPresence);
