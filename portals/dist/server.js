// GENERATED from portals/server/*.ts by the portals-server-script plugin in portals/vite.config.ts. Portals runs this as the session referee; it ships publicly.
"use strict";
(() => {
  // src/duel/duel-protocol.ts
  var DUEL_PROTOCOL = 2;
  var MAX_DUEL_PLAYERS = 4;
  var DUEL_WIRE_MAX_BYTES = 8 * 1024;
  var DUEL_MATCH_KEY = "miw-duel:match";
  var REFEREE_STATE_KEY = "server:referee";
  var DUEL_SEATS = ["a", "b", "c", "d"];
  function wireBytes(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function shortText(value, max) {
    return typeof value === "string" && value.length <= max;
  }
  function validPlayer(value) {
    if (!value || typeof value !== "object") return false;
    const player = value;
    return shortText(player.token, 80) && player.token.length > 0 && shortText(player.connId, 80) && shortText(player.name, 40) && (player.avatarCode === null || shortText(player.avatarCode, 64));
  }
  function parseDuelMatch(value) {
    if (!value || typeof value !== "object" || wireBytes(value) > DUEL_WIRE_MAX_BYTES) return null;
    const match = value;
    if (match.v !== DUEL_PROTOCOL || !finiteNumber(match.seq)) return null;
    if (!Number.isInteger(match.seq) || match.seq < 1) return null;
    const players = match.players;
    if (!players || !validPlayer(players.a) || !DUEL_SEATS.every(
      (seat) => seat === "a" || players[seat] === null || validPlayer(players[seat])
    )) return null;
    const turn = match.turn;
    if (!turn || !finiteNumber(turn.number) || !DUEL_SEATS.includes(turn.runner) || !finiteNumber(turn.heartsLeft) || !["handoff", "running", "worsening"].includes(turn.phase) || !finiteNumber(turn.deadlineAt)) return null;
    const score = match.score;
    if (!score || !DUEL_SEATS.every((seat) => finiteNumber(score[seat]))) return null;
    if (typeof match.started !== "boolean") return null;
    const seatList = (value2) => Array.isArray(value2) && value2.length <= DUEL_SEATS.length && value2.every((seat) => DUEL_SEATS.includes(seat));
    if (!seatList(match.out) || !seatList(match.retired)) return null;
    if (!finiteNumber(match.round)) return null;
    if (match.courseCode !== null && !shortText(match.courseCode, 8e3)) return null;
    if (match.courseVersion !== null && !shortText(match.courseVersion, 80)) return null;
    const courseTitle = match.courseTitle ?? null;
    const courseBaseVersion = match.courseBaseVersion ?? null;
    if (courseTitle !== null && !shortText(courseTitle, 80)) return null;
    if (courseBaseVersion !== null && !shortText(courseBaseVersion, 80)) return null;
    const history = match.history ?? [];
    if (!Array.isArray(history) || history.length > 16 || !history.every(
      (round) => !!round && typeof round === "object" && DUEL_SEATS.includes(round.winner) && finiteNumber(round.turns) && ["hearts", "forfeit"].includes(round.reason)
    )) return null;
    const result = match.result;
    if (result !== null && result !== void 0) {
      if (!DUEL_SEATS.includes(result.winner) || !["rounds", "forfeit", "left"].includes(result.reason)) return null;
    }
    return { ...match, courseTitle, courseBaseVersion, history };
  }
  function seatedSeats(match) {
    return DUEL_SEATS.filter(
      (seat) => match.players[seat] !== null && !match.retired.includes(seat)
    );
  }

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
    const seat = claim.seat;
    if (seat !== void 0 && seat !== null && !DUEL_SEATS.includes(seat)) return null;
    return {
      k: "seat",
      v: DUEL_PROTOCOL,
      token: claim.token,
      name: claim.name,
      avatarCode: claim.avatarCode ?? null,
      seat: seat ?? null
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
    const taken = (seat) => seats.some((held) => held.seat === seat);
    const freeSeat = () => DUEL_SEATS.find((seat) => !taken(seat)) ?? null;
    const adoptRecord = (value) => {
      const match = parseDuelMatch(value);
      if (!match) return;
      let changed = false;
      for (const seat of seatedSeats(match)) {
        const player = match.players[seat];
        if (taken(seat) || seats.some((held) => held.token === player.token)) continue;
        seats = [
          ...seats,
          {
            seat,
            token: player.token,
            connId: player.connId,
            name: player.name,
            avatarCode: player.avatarCode
          }
        ];
        changed = true;
      }
      if (match.started && !started) {
        started = true;
        startedAt = Date.now();
        changed = true;
      }
      if (changed) publish();
    };
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
      const seat = claim.seat !== null && !taken(claim.seat) ? claim.seat : freeSeat();
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
    host.on("state", ((key, value) => {
      if (key === DUEL_MATCH_KEY) adoptRecord(value);
    }));
    try {
      adoptRecord(host.getState(DUEL_MATCH_KEY));
    } catch {
    }
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
