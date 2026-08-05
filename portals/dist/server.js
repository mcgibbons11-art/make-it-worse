// GENERATED from portals/server/*.ts by the portals-server-script plugin in portals/vite.config.ts. Portals runs this as the session referee; it ships publicly.
"use strict";
(() => {
  // src/duel/duel-protocol.ts
  var DUEL_PROTOCOL = 2;
  var MAX_DUEL_PLAYERS = 4;
  var DUEL_WIRE_MAX_BYTES = 8 * 1024;
  var REFEREE_STATE_KEY = "server:referee";
  var DUEL_SEATS = ["a", "b", "c", "d"];

  // server/referee.ts
  var REFEREE_BUILD = 2;
  function text(value, max) {
    return typeof value === "string" && value.length > 0 && value.length <= max;
  }
  function parseClaim(value) {
    if (!value || typeof value !== "object") return null;
    const claim = value;
    if (claim.v !== DUEL_PROTOCOL) return null;
    if (!text(claim.token, 80)) return null;
    if (claim.k === "start") return { k: "start", v: DUEL_PROTOCOL, token: claim.token };
    if (claim.k !== "seat") return null;
    if (!text(claim.name, 40)) return null;
    if (claim.avatarCode !== null && !text(claim.avatarCode, 64)) return null;
    return {
      k: "seat",
      v: DUEL_PROTOCOL,
      token: claim.token,
      name: claim.name,
      avatarCode: claim.avatarCode ?? null
    };
  }
  function createReferee(host) {
    let seats = [];
    let started = false;
    let startedAt = null;
    const publish = () => {
      const lobby = {
        build: REFEREE_BUILD,
        v: DUEL_PROTOCOL,
        seats,
        started,
        startedAt
      };
      host.setState(REFEREE_STATE_KEY, lobby);
    };
    const freeSeat = () => DUEL_SEATS.find((seat) => !seats.some((held) => held.seat === seat)) ?? null;
    const claimSeat = (claim, fromId) => {
      const existing = seats.find((seat2) => seat2.token === claim.token);
      if (existing) {
        if (existing.connId === fromId && existing.name === claim.name && existing.avatarCode === claim.avatarCode)
          return;
        seats = seats.map(
          (seat2) => seat2.token === claim.token ? { ...seat2, connId: fromId, name: claim.name, avatarCode: claim.avatarCode } : seat2
        );
        publish();
        return;
      }
      if (started) return;
      const seat = freeSeat();
      if (!seat) return;
      seats = [
        ...seats,
        { seat, token: claim.token, connId: fromId, name: claim.name, avatarCode: claim.avatarCode }
      ];
      publish();
    };
    const start = (claim) => {
      if (started) return;
      const host_ = seats.find((seat) => seat.seat === "a");
      if (!host_ || host_.token !== claim.token) return;
      if (seats.length < 2) return;
      started = true;
      startedAt = Date.now();
      publish();
    };
    const dropConnection = (connId) => {
      if (started) return;
      const remaining = seats.filter((seat) => seat.connId !== connId);
      if (remaining.length === seats.length) return;
      seats = remaining;
      publish();
    };
    host.on("message", ((data, fromId) => {
      const claim = parseClaim(data);
      if (!claim) return;
      if (claim.k === "seat") claimSeat(claim, fromId);
      else start(claim);
    }));
    host.on("playerleave", ((player) => dropConnection(player.id)));
    host.on("playerjoin", (() => publish()));
    publish();
    return {
      /** Exposed for tests; the live server drives everything through events. */
      lobby: () => ({
        build: REFEREE_BUILD,
        v: DUEL_PROTOCOL,
        seats,
        started,
        startedAt
      }),
      seatCount: () => seats.length,
      maxSeats: MAX_DUEL_PLAYERS
    };
  }

  // server/server-entry.ts
  createReferee(server);
})();
