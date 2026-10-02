// HOP-HOP — game.js
// Owns: HH.game state object, main loop, input, procedural lane generation,
// player movement / log riding, collisions, camera, eagle, persistence.
// Renderer / UI / FX / audio are only called from inside functions (load-order safe).
(function () {
  'use strict';

  const HH = (window.HH = window.HH || {});
  const COLS = HH.COLS || 9;
  const PAD = HH.PAD || 14;
  const HOP_TIME = HH.HOP_TIME || 0.14;
  const LEVEL = HH.LEVEL || { grass: 0, road: 0, rail: 0, river: -0.18 };
  const LOG_TOP = HH.LOG_TOP != null ? HH.LOG_TOP : 0.06;
  const STORAGE = HH.STORAGE || { best: 'hophop.best', coins: 'hophop.coins', muted: 'hophop.muted' };
  const LOOP = COLS + 2 * PAD;          // cyclic length of traffic / log loops
  const X_MIN = -PAD, X_MAX = COLS + PAD; // lane x extent

  // ---------------------------------------------------------------- helpers
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1)); // inclusive
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const chance = (p) => Math.random() < p;
  const wrapX = (x) => ((((x - X_MIN) % LOOP) + LOOP) % LOOP) + X_MIN;
  const difficulty = (row) => clamp(row / 250, 0, 1);

  function lsGet(key, def) {
    try { const v = window.localStorage.getItem(key); return v == null ? def : v; } catch (e) { return def; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, String(val)); } catch (e) { /* storage unavailable */ }
  }

  // Guarded module calls: a missing / throwing module must never kill the game loop.
  const errOnce = {};
  function safe(tag, fn) {
    try { fn(); } catch (e) { if (!errOnce[tag]) { errOnce[tag] = true; console.error('[HOP-HOP] ' + tag, e); } }
  }
  function sound(name) {
    if (HH.audio && typeof HH.audio.play === 'function') safe('audio.play', () => HH.audio.play(name));
  }
  function fx(name) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (HH.fx && typeof HH.fx[name] === 'function') safe('fx.' + name, () => HH.fx[name].apply(HH.fx, args));
  }
  function audioInit() {
    if (HH.audio && typeof HH.audio.init === 'function') safe('audio.init', () => HH.audio.init());
  }

  // ---------------------------------------------------------------- state
  const game = (HH.game = {
    state: 'title',
    paused: false,
    time: 0,
    lanes: new Map(),
    minRow: 0,
    maxRow: 0,
    player: null,
    cam: { x: 4.5, row: 0, shake: 0 },
    score: 0,
    best: parseInt(lsGet(STORAGE.best, '0'), 10) || 0,
    coins: 0,                                                    // coins collected this run
    totalCoins: parseInt(lsGet(STORAGE.coins, '0'), 10) || 0,    // EXTENSION: persisted lifetime coins
    newBest: false,
    deathCause: null,
    eagle: null,
    danger: 0,
    overT: 0,
    muted: lsGet(STORAGE.muted, '0') === '1',
    isTouch: false,
    heroName: 'Blip',                                            // EXTENSION: hero name for UI
  });

  // Internal (not part of the read-only contract)
  let gen = null;            // lane generator state
  let hop = null;            // current hop details
  let ride = null;           // { lane, log, off } while standing on a log
  let squashV = 0, antennaV = 0;
  let blinkTimer = rand(2, 5), blinkT = -1;
  let inputQueue = [];
  let scrollFloor = -1.5, scrollStarted = false;
  let deathT = 0;
  let bestAtStart = game.best;
  let eagleAnim = null;      // { t, sx, sr, tx, tr, tz }

  function makePlayer() {
    return {
      x: 4, y: 0, z: 0, groundZ: LEVEL.grass || 0,
      facing: 'up', hopT: -1, squash: 0, antenna: 0, blink: 1,
      visible: true, sink: 0,
    };
  }

  // ================================================================ LANE GENERATION

  function obstacleAt(lane, col) {
    if (!lane || lane.type !== 'grass') return false;
    const obs = lane.obstacles;
    for (let i = 0; i < obs.length; i++) if (obs[i].col === col) return true;
    return false;
  }

  function makeTufts() {
    const t = [];
    for (let i = 0; i < 14; i++) t.push({ x: rand(X_MIN, X_MAX), r: rand(0.12, 0.88), s: rand(0.5, 1) });
    return t;
  }

  function makeObstacle(col, rockP) {
    if (chance(rockP)) return { col, kind: 'rock', tiers: 1, variant: randInt(0, 2) };
    return { col, kind: 'tree', tiers: randInt(1, 3), variant: randInt(0, 2) };
  }

  function baseLane(row, type) {
    return { row, type, coins: [], seed: Math.random() };
  }

  // Out-of-bounds decoration (dense trees on both sides of the playfield)
  function decorateOOB(obstacles) {
    for (let c = X_MIN; c < X_MAX; c++) {
      if (c >= 0 && c < COLS) continue;
      const nearEdge = c === -1 || c === COLS;
      if (nearEdge ? chance(0.85) : chance(0.7)) obstacles.push(makeObstacle(c, 0.12));
    }
  }

  function grassLane(row) {
    const lane = baseLane(row, 'grass');
    lane.shade = ((row % 2) + 2) % 2;
    lane.obstacles = [];
    lane.tufts = makeTufts();
    return lane;
  }

  // Lay out `n` objects with lengths from lenFn on a cyclic loop of length LOOP,
  // with every gap (including the wrap seam) inside [gmin, gmax]. Returns [{x,len}].
  function layoutLoop(lenFn, gmin, gmax) {
    const lens = [];
    let sum = 0;
    const avg = (gmin + gmax) / 2;
    while (lens.length < 60) {
      const l = lenFn();
      if (lens.length > 0 && sum + l + (lens.length + 1) * avg > LOOP) break;
      lens.push(l); sum += l;
    }
    let G = LOOP - sum;
    // too sparse -> add objects
    let guard = 0;
    while (G / lens.length > gmax && guard++ < 40) {
      const l = lenFn();
      if ((G - l) / (lens.length + 1) < gmin) break;
      lens.push(l); sum += l; G = LOOP - sum;
    }
    // too dense -> remove objects
    while (lens.length > 1 && G / lens.length < gmin) { sum -= lens.pop(); G = LOOP - sum; }
    // shuffle lengths so trucks etc. aren't clumped at the end
    for (let i = lens.length - 1; i > 0; i--) { const j = randInt(0, i); const t = lens[i]; lens[i] = lens[j]; lens[j] = t; }

    const n = lens.length, base = G / n;
    const gaps = new Array(n).fill(base);
    const jit = Math.max(0, Math.min(base - gmin, gmax - base));
    // pairwise jitter keeps the total exactly LOOP and each gap within bounds
    for (let i = 0; i + 1 < n; i += 2) { const dl = rand(-jit, jit); gaps[i] += dl; gaps[i + 1] -= dl; }

    const out = [];
    let pos = rand(0, LOOP);
    for (let i = 0; i < n; i++) {
      out.push({ x: wrapX(X_MIN + pos), len: lens[i] });
      pos += lens[i] + gaps[i];
    }
    return out;
  }

  function roadLane(row, d) {
    const lane = baseLane(row, 'road');
    lane.dir = chance(0.5) ? 1 : -1;
    lane.speed = Math.min(7, (1.5 + 3.5 * d) * rand(0.75, 1.3));
    lane.lineAbove = false;
    const gmin = lerp(3, 2.6, d), gmax = lerp(7, 4, d);
    lane.vehicles = layoutLoop(() => (chance(0.3) ? 2 : 1), gmin, gmax).map((o) => ({
      x: o.x, len: o.len, kind: o.len === 2 ? 'truck' : 'car', color: randInt(0, 5),
    }));
    if (chance(0.12)) lane.coins.push({ col: randInt(0, COLS - 1), taken: false, phase: rand(0, Math.PI * 2) });
    return lane;
  }

  function riverLane(row, d, dir) {
    const lane = baseLane(row, 'river');
    lane.dir = dir;
    lane.speed = (0.8 + 1.8 * d) * rand(0.8, 1.25);
    const maxLen = d > 0.66 ? 3 : 4;
    const minLen = 2;
    lane.logs = layoutLoop(() => randInt(minLen, maxLen), 1, 2.6).map((o) => ({ x: o.x, len: o.len }));
    lane.ripples = [];
    for (let i = 0; i < 10; i++) lane.ripples.push({ x: rand(X_MIN, X_MAX), r: rand(0.15, 0.85), phase: rand(0, Math.PI * 2) });
    return lane;
  }

  function railIdleTime(d) { return Math.max(2.5, rand(3, 7) - 1.5 * d); }

  function railLane(row, d) {
    const lane = baseLane(row, 'rail');
    lane.light = false;
    lane.train = { state: 'idle', t: rand(0.8, railIdleTime(d)), x: X_MIN - 60, dir: chance(0.5) ? 1 : -1, cars: 3, len: 9.6 };
    lane._bells = 0;       // EXTENSION (internal): bells rung during current warning
    return lane;
  }

  // Grass lane on the playable path with the never-impossible reachability guarantee.
  function pathGrassLane(row, d, prevReach, afterRiver) {
    const lane = grassLane(row);
    const blocked = new Array(COLS).fill(false);
    const density = 0.15 + 0.15 * d;
    for (let c = 0; c < COLS; c++) if (chance(density)) blocked[c] = true;
    if (afterRiver) {
      // at most 3 in-bound obstacles directly after a river
      let idx = [];
      for (let c = 0; c < COLS; c++) if (blocked[c]) idx.push(c);
      while (idx.length > 3) { const k = randInt(0, idx.length - 1); blocked[idx[k]] = false; idx.splice(k, 1); }
    }

    let reach;
    for (let attempt = 0; attempt < COLS + 1; attempt++) {
      reach = new Array(COLS).fill(false);
      const stack = [];
      for (let c = 0; c < COLS; c++) if (prevReach[c] && !blocked[c]) { reach[c] = true; stack.push(c); }
      if (stack.length === 0) {
        // unblock a column the player can arrive from, then retry
        const cand = [];
        for (let c = 0; c < COLS; c++) if (prevReach[c]) cand.push(c);
        const c = cand.length ? cand[randInt(0, cand.length - 1)] : randInt(0, COLS - 1);
        blocked[c] = false;
        continue;
      }
      // horizontal flood fill within free cells
      while (stack.length) {
        const c = stack.pop();
        for (const n of [c - 1, c + 1]) {
          if (n >= 0 && n < COLS && !blocked[n] && !reach[n]) { reach[n] = true; stack.push(n); }
        }
      }
      break;
    }

    for (let c = 0; c < COLS; c++) if (blocked[c]) lane.obstacles.push(makeObstacle(c, 0.25));
    decorateOOB(lane.obstacles);

    if (chance(0.14)) {
      const free = [];
      for (let c = 0; c < COLS; c++) if (reach[c] && !blocked[c]) free.push(c);
      if (free.length) lane.coins.push({ col: free[randInt(0, free.length - 1)], taken: false, phase: rand(0, Math.PI * 2) });
    }
    return { lane, reach };
  }

  function newGen(startRow) {
    return {
      row: startRow,
      reach: new Array(COLS).fill(true),
      segType: 'grass',
      segLeft: 0,
      lastSeg: 'grass',
      prevType: 'grass',
      prevRiverDir: 1,
    };
  }

  function chooseSegment(row) {
    const d = difficulty(row);
    const wasHazard = gen.lastSeg !== 'grass';
    let type;
    if (wasHazard && !(d > 0.3 && chance(0.3 * d))) {
      type = 'grass';
    } else {
      const wRoad = 1, wRiver = row >= 8 ? 0.7 : 0, wRail = row >= 15 ? 0.45 : 0;
      let r = Math.random() * (wRoad + wRiver + wRail);
      if ((r -= wRoad) < 0) type = 'road';
      else if ((r -= wRiver) < 0) type = 'river';
      else type = 'rail';
      // avoid the same hazard type twice in a row when skipping grass (keeps alternation sane)
      if (wasHazard && type === gen.lastSeg) type = type === 'road' ? (row >= 15 ? 'rail' : 'road') : 'road';
    }
    let len;
    switch (type) {
      case 'grass': len = d > 0.5 ? randInt(1, 2) : randInt(1, 3); break;
      case 'road': len = randInt(1, 1 + Math.round(3 * d)); break;
      case 'river': len = randInt(1, 2 + Math.round(2 * d)); break;
      default: len = randInt(1, 1 + Math.round(d)); break;
    }
    gen.segType = type; gen.segLeft = len; gen.lastSeg = type;
  }

  function generateLane(row) {
    let lane;
    const d = difficulty(row);
    if (row <= -3) {
      // solid tree wall behind the start
      lane = grassLane(row);
      for (let c = X_MIN; c < X_MAX; c++) lane.obstacles.push(makeObstacle(c, 0.1));
      gen.reach = new Array(COLS).fill(false);
    } else if (row < 0) {
      lane = grassLane(row);
      for (let c = 0; c < COLS; c++) if (chance(0.3)) lane.obstacles.push(makeObstacle(c, 0.25));
      decorateOOB(lane.obstacles);
    } else if (row <= 2) {
      lane = grassLane(row);
      decorateOOB(lane.obstacles);
      gen.reach = new Array(COLS).fill(true);
    } else {
      if (gen.segLeft <= 0) chooseSegment(row);
      gen.segLeft--;
      const t = gen.segType;
      if (t === 'grass') {
        const r = pathGrassLane(row, d, gen.reach, gen.prevType === 'river');
        lane = r.lane; gen.reach = r.reach;
      } else {
        if (t === 'road') lane = roadLane(row, d);
        else if (t === 'river') {
          const dir = gen.prevType === 'river' ? -gen.prevRiverDir : (chance(0.5) ? 1 : -1);
          lane = riverLane(row, d, dir);
          gen.prevRiverDir = dir;
        } else lane = railLane(row, d);
        gen.reach = new Array(COLS).fill(true);
      }
    }
    // dashed separator between consecutive road lanes
    const below = game.lanes.get(row - 1);
    if (lane.type === 'road' && below && below.type === 'road') below.lineAbove = true;
    gen.prevType = lane.type;
    game.lanes.set(row, lane);
  }

  function visibleRange() {
    let vr = null;
    if (HH.render && typeof HH.render.visibleRange === 'function') {
      try { vr = HH.render.visibleRange(); } catch (e) { vr = null; }
    }
    if (!vr || !isFinite(vr.maxRow) || !isFinite(vr.minRow)) vr = { minRow: game.cam.row - 6, maxRow: game.cam.row + 18 };
    return vr;
  }

  function ensureLanes() {
    const target = Math.max(visibleRange().maxRow, game.player.y + 8) + 12;
    while (gen.row <= target) { generateLane(gen.row); gen.row++; }
    const cut = game.cam.row - 12;
    for (const r of game.lanes.keys()) if (r < cut) game.lanes.delete(r);
    let mn = Infinity, mx = -Infinity;
    for (const r of game.lanes.keys()) { if (r < mn) mn = r; if (r > mx) mx = r; }
    game.minRow = mn; game.maxRow = mx;
  }

  // ================================================================ WORLD UPDATE

  function updateLanes(dt) {
    const audible = game.state !== 'title';
    for (const lane of game.lanes.values()) {
      if (lane.type === 'road') {
        const v = lane.dir * lane.speed * dt;
        for (const car of lane.vehicles) {
          car.x += v;
          if (lane.dir > 0 && car.x >= X_MAX) car.x -= LOOP;
          else if (lane.dir < 0 && car.x + car.len <= X_MIN) car.x += LOOP;
        }
      } else if (lane.type === 'river') {
        const v = lane.dir * lane.speed * dt;
        for (const log of lane.logs) {
          log.x += v;
          if (lane.dir > 0 && log.x >= X_MAX) log.x -= LOOP;
          else if (lane.dir < 0 && log.x + log.len <= X_MIN) log.x += LOOP;
        }
        for (const rp of lane.ripples) rp.x = wrapX(rp.x + v);
      } else if (lane.type === 'rail') {
        updateRail(lane, dt, audible && Math.abs(lane.row - game.cam.row) < 11);
      }
    }
  }

  function updateRail(lane, dt, audible) {
    const tr = lane.train;
    if (tr.state === 'idle') {
      lane.light = false;
      tr.t -= dt;
      if (tr.t <= 0) {
        tr.state = 'warn'; tr.t = 1.3; lane._bells = 1;
        tr.dir = chance(0.5) ? 1 : -1;
        if (audible) sound('bell');
      }
    } else if (tr.state === 'warn') {
      tr.t -= dt;
      const el = 1.3 - tr.t;
      lane.light = Math.floor(el * 12) % 2 === 0; // ~6 Hz flashing
      if (lane._bells < 3 && el >= lane._bells * 0.45) { lane._bells++; if (audible) sound('bell'); }
      if (tr.t <= 0) {
        tr.state = 'pass'; tr.t = 0;
        tr.cars = 1 + randInt(2, 4);    // loco + 2..4 cars (total segments)
        tr.len = tr.cars * 3.2;
        tr.x = tr.dir > 0 ? X_MIN - tr.len - 1 : X_MAX + 1;
        if (audible) sound('train');
      }
    } else if (tr.state === 'pass') {
      tr.t += dt;
      lane.light = Math.floor(tr.t * 12) % 2 === 0;
      tr.x += tr.dir * 22 * dt;
      if ((tr.dir > 0 && tr.x > X_MAX) || (tr.dir < 0 && tr.x + tr.len < X_MIN)) {
        tr.state = 'idle';
        tr.t = railIdleTime(difficulty(lane.row));
        lane.light = false;
      }
    }
  }

  // ================================================================ PLAYER

  const DIRS = {
    up: { dx: 0, dy: 1 }, down: { dx: 0, dy: -1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
  };

  function kickAntenna(dx) {
    antennaV += (dx !== 0 ? -dx : (chance(0.5) ? 1 : -1)) * rand(7, 10);
  }

  function bump(dir) {
    const p = game.player;
    p.facing = dir;
    p.squash = -0.15; squashV = 0;
    kickAntenna(DIRS[dir].dx);
    sound('bump');
  }

  // Attempt a hop in direction `dir`. Returns true if a hop started.
  function tryHop(dir) {
    const p = game.player;
    const D = DIRS[dir];
    if (!D || p.hopT >= 0) return false;
    const curRow = Math.round(p.y);
    const cur = game.lanes.get(curRow);
    const ty = curRow + D.dy;
    const target = game.lanes.get(ty);
    let tx;
    const onRiver = cur && cur.type === 'river';

    if (onRiver) {
      if (D.dx !== 0) tx = p.x + D.dx;
      else if (target && target.type === 'river') tx = p.x;
      else tx = clamp(Math.round(p.x), 0, COLS - 1);
    } else {
      tx = Math.round(p.x) + D.dx;
    }

    const outLat = onRiver ? (tx < -0.3 || tx > COLS - 0.7) : (tx < 0 || tx > COLS - 1);
    if (ty <= -3 || !target || outLat || (target.type === 'grass' && obstacleAt(target, Math.round(tx)))) {
      bump(dir);
      return false;
    }

    const fromGZ = p.groundZ;
    const toGZ = target.type === 'river' ? LOG_TOP : (LEVEL[target.type] || 0);
    // a lateral hop while riding keeps drifting with the current
    const drift = onRiver && D.dx !== 0 && ride ? cur.dir * cur.speed : 0;
    hop = { fromX: p.x, fromY: p.y, toX: tx, toY: ty, fromGZ, toGZ, drift, dir };
    ride = null;
    p.facing = dir;
    p.hopT = 0;
    p.squash = 0.25; squashV = 0;
    kickAntenna(D.dx);
    sound('hop');
    if (!scrollStarted && game.state === 'play') scrollStarted = true;
    return true;
  }

  function landHop() {
    const p = game.player;
    p.x = hop.toX; p.y = hop.toY; p.z = 0; p.groundZ = hop.toGZ;
    p.hopT = -1;
    p.squash = -0.3; squashV = 0;
    hop = null;
    const lane = game.lanes.get(Math.round(p.y));
    fx('dust', p.x + 0.5, p.y + 0.5, p.groundZ);
    if (lane && lane.type === 'river') {
      const c = p.x + 0.5;
      let found = null;
      for (const log of lane.logs) if (c >= log.x - 0.15 && c <= log.x + log.len + 0.15) { found = log; break; }
      if (found) {
        ride = { lane, log: found, off: clamp(Math.round(p.x - found.x), 0, found.len - 1) };
        p.groundZ = LOG_TOP;
      } else {
        drown();
        return;
      }
    } else {
      p.groundZ = lane ? (LEVEL[lane.type] || 0) : 0;
    }
  }

  function updatePlayerMotion(dt) {
    const p = game.player;
    if (hop) {
      if (hop.drift) { hop.fromX += hop.drift * dt; hop.toX += hop.drift * dt; }
      p.hopT = Math.min(1, p.hopT + dt / HOP_TIME);
      const t = p.hopT, e = t * (2 - t); // ease-out
      p.x = lerp(hop.fromX, hop.toX, e);
      p.y = lerp(hop.fromY, hop.toY, e);
      p.z = 0.5 * Math.sin(Math.PI * t);
      p.groundZ = lerp(hop.fromGZ, hop.toGZ, e);
      p.squash = 0.25 * (1 - 0.6 * t);
      if (p.hopT >= 1) landHop();
    } else if (ride) {
      // ride the log, easing toward the snapped slot
      const log = ride.log;
      let rel = p.x - log.x;
      rel += (ride.off - rel) * (1 - Math.exp(-dt * 22));
      p.x = log.x + rel;
      p.groundZ = LOG_TOP;
      if (p.x < -0.45 || p.x > COLS - 0.55) drown();
    }
    // process buffered input once idle
    if (game.state === 'play' && p.hopT < 0 && inputQueue.length) tryHop(inputQueue.shift());
  }

  // springs + blink: always animated (title, play, dying, over)
  function updatePlayerAnim(dt) {
    const p = game.player;
    if (p.hopT < 0) {
      // squash spring (stiffness ~300, damping ~14) — semi-implicit Euler, substepped for stability
      const steps = 2, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        squashV += (-300 * p.squash - 14 * squashV) * h;
        p.squash += squashV * h;
      }
    }
    // antenna damped spring
    const ah = dt / 2;
    for (let i = 0; i < 2; i++) {
      antennaV += (-160 * p.antenna - 7 * antennaV) * ah;
      p.antenna += antennaV * ah;
    }
    p.antenna = clamp(p.antenna, -1.2, 1.2);
    // blink
    if (blinkT >= 0) {
      blinkT += dt;
      const k = blinkT / 0.12;
      if (k >= 1) { blinkT = -1; p.blink = 1; blinkTimer = rand(2, 5); }
      else p.blink = Math.abs(1 - 2 * k);
    } else {
      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkT = 0;
    }
    if (p.sink > 0 && p.sink < 1) p.sink = Math.min(1, p.sink + dt / 0.4);
  }

  // ================================================================ DEATHS

  function startDying(cause) {
    if (game.state !== 'play') return;
    game.state = 'dying';
    game.deathCause = cause;
    deathT = 0;
    inputQueue.length = 0;
    const p = game.player;
    if (cause !== 'water') { hop = null; p.hopT = -1; }
    ride = null;
  }

  function hitBy(cause) {
    const p = game.player;
    const z = p.groundZ + p.z;
    startDying(cause);
    p.visible = false;
    fx('explode', p.x + 0.5, p.y + 0.5, z + 0.4);
    sound('crash');
    game.cam.shake = cause === 'train' ? 20 : 14;
    p.z = 0;
  }

  function drown() {
    const p = game.player;
    startDying('water');
    hop = null; p.hopT = -1; p.z = 0;
    p.groundZ = LEVEL.river;
    p.sink = 0.0001; // starts the 0->1 sink animation
    fx('splash', p.x + 0.5, p.y + 0.5, LEVEL.river);
    sound('splash');
  }

  function eagleDeath() {
    const p = game.player;
    startDying('eagle');
    p.z = 0;
    const tx = p.x + 0.5, tr = p.y + 0.5;
    game.eagle = { x: tx, row: p.y + 9, z: 6, flap: 0, carrying: false };
    eagleAnim = { t: 0, sx: tx, sr: p.y + 9, tx, tr, tz: p.groundZ + 0.8 };
    sound('eagle');
  }

  function updateEagle(dt) {
    const e = game.eagle;
    if (!e) return;
    const a = eagleAnim;
    a.t += dt;
    e.flap += dt * (e.carrying ? 16 : 9);
    const DIVE = 0.55;
    if (a.t < DIVE) {
      const k = Math.pow(a.t / DIVE, 2); // ease in
      e.x = lerp(a.sx, a.tx, k);
      e.row = lerp(a.sr, a.tr, k);
      e.z = lerp(6, a.tz, k);
    } else {
      if (!e.carrying) {
        e.carrying = true;
        game.player.visible = false;
        fx('feathers', a.tx, a.tr, a.tz);
        game.cam.shake = Math.max(game.cam.shake, 6);
      }
      const u = (a.t - DIVE) / 1.0;
      e.x = a.tx + Math.sin(u * 3) * 0.3;
      e.row = a.tr + 2 * u + 12 * u * u;
      e.z = a.tz + 1.5 * u + 4 * u * u;
    }
  }

  // ================================================================ COLLISIONS / PICKUPS

  function checkCollisions() {
    const p = game.player;
    if (!p.visible) return;
    const lane = game.lanes.get(Math.round(p.y));
    if (!lane) return;
    const a0 = p.x + 0.22, a1 = p.x + 0.78;
    if (lane.type === 'road') {
      for (const v of lane.vehicles) {
        if (a1 > v.x + 0.08 && a0 < v.x + v.len - 0.08) { hitBy('car'); return; }
      }
    } else if (lane.type === 'rail') {
      const tr = lane.train;
      if (tr.state === 'pass' && a1 > tr.x && a0 < tr.x + tr.len) hitBy('train');
    }
  }

  function checkCoins() {
    const p = game.player;
    const lane = game.lanes.get(Math.round(p.y));
    if (!lane || !lane.coins.length) return;
    for (const c of lane.coins) {
      if (!c.taken && Math.abs(p.x - c.col) < 0.5) {
        c.taken = true;
        game.coins++;
        fx('sparkle', c.col + 0.5, lane.row + 0.5, p.groundZ + 0.3);
        fx('popup', c.col + 0.5, lane.row + 0.5, p.groundZ + 0.8, '+1');
        sound('coin');
      }
    }
  }

  // ================================================================ CAMERA

  function updateCamera(dt) {
    const p = game.player, cam = game.cam;
    if (game.state === 'play') {
      if (scrollStarted) scrollFloor += (0.42 + 0.55 * difficulty(game.score)) * dt;
      scrollFloor = Math.max(scrollFloor, p.y - 1.5);
      game.danger = clamp((scrollFloor - p.y - 1.8) / 1.4, 0, 1);
      if (scrollFloor - p.y > 3.2) eagleDeath();
    } else {
      game.danger = Math.max(0, game.danger - dt * 3);
    }
    const k = 1 - Math.exp(-dt * 6);
    const targetRow = game.state === 'title' ? p.y : Math.max(p.y, scrollFloor);
    cam.row += (targetRow - cam.row) * k;
    const targetX = 4.5 * 0.65 + (p.x + 0.5) * 0.35;
    cam.x += (targetX - cam.x) * k;
    cam.shake *= Math.exp(-dt * 6);
    if (cam.shake < 0.3) cam.shake = 0;
  }

  // ================================================================ GAME FLOW

  function resetWorld() {
    game.lanes = new Map();
    game.player = makePlayer();
    game.cam.x = 4.5; game.cam.row = 0; game.cam.shake = 0;
    game.score = 0; game.coins = 0; game.newBest = false;
    game.deathCause = null; game.eagle = null; eagleAnim = null;
    game.danger = 0; game.overT = 0;
    hop = null; ride = null; squashV = 0; antennaV = 0;
    inputQueue.length = 0;
    scrollFloor = -1.5; scrollStarted = false;
    deathT = 0;
    bestAtStart = game.best;
    gen = newGen(-12);
    ensureLanes();
  }

  function startFromTitle() {
    game.state = 'play';
    sound('start');
  }

  function newRun() {
    resetWorld();
    if (HH.fx && typeof HH.fx.clear === 'function') safe('fx.clear', () => HH.fx.clear());
    game.state = 'play';
    sound('start');
  }

  function toOver() {
    game.state = 'over';
    game.overT = 0;
    game.totalCoins += game.coins;
    lsSet(STORAGE.coins, game.totalCoins);
    game.newBest = game.score > bestAtStart;
    if (game.score > game.best) game.best = game.score;
    lsSet(STORAGE.best, game.best);
    sound(game.newBest ? 'newbest' : 'over');
  }

  function update(dt) {
    game.time += dt;
    ensureLanes();
    updateLanes(dt);

    if (game.state === 'play') {
      updatePlayerMotion(dt);
      if (game.state === 'play') {
        checkCollisions();
        if (game.state === 'play') checkCoins();
        game.score = Math.max(game.score, Math.round(game.player.y));
        if (game.score > game.best) game.best = game.score; // live best (newBest uses bestAtStart)
      }
    } else if (game.state === 'dying') {
      deathT += dt;
      updateEagle(dt);
      if (deathT >= (game.deathCause === 'eagle' ? 1.8 : 1.3)) toOver();
    } else if (game.state === 'over') {
      game.overT += dt;
      updateEagle(dt);
    }

    updatePlayerAnim(dt);
    updateCamera(dt);
    if (HH.fx && typeof HH.fx.update === 'function') safe('fx.update', () => HH.fx.update(dt));
  }

  // ================================================================ INPUT

  let resetClock = true;

  function setPaused(v) {
    if (v && game.state !== 'play') return;
    if (game.paused === v) return;
    game.paused = v;
    inputQueue.length = 0;
    if (!v) resetClock = true;
  }

  function toggleMute() {
    game.muted = !game.muted;
    if (HH.audio && typeof HH.audio.setMuted === 'function') safe('audio.setMuted', () => HH.audio.setMuted(game.muted));
    lsSet(STORAGE.muted, game.muted ? '1' : '0');
    if (!game.muted) sound('click');
  }

  // Central action dispatcher: 'up'|'down'|'left'|'right'|'confirm'|'pause'|'mute'|'tap'
  function action(a) {
    if (a === 'mute') { toggleMute(); return; }
    if (a === 'pause') {
      if (game.paused) setPaused(false);
      else if (game.state === 'play') setPaused(true);
      return;
    }
    if (game.paused) {
      if (a === 'confirm' || a === 'tap') setPaused(false);
      return;
    }
    if (a === 'confirm' || a === 'tap') {
      if (game.state === 'title') startFromTitle();
      else if (game.state === 'over') { if (game.overT > 0.5) newRun(); }
      else if (game.state === 'play' && a === 'tap') queueHop('up');
      return;
    }
    if (DIRS[a]) {
      if (game.state === 'title') { startFromTitle(); queueHop(a); }
      else if (game.state === 'play') queueHop(a);
    }
  }

  function queueHop(dir) {
    if (game.state !== 'play' || game.paused) return;
    if (game.player.hopT < 0 && inputQueue.length === 0) { tryHop(dir); return; }
    if (inputQueue.length < 2) inputQueue.push(dir);
  }

  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'confirm', Enter: 'confirm', NumpadEnter: 'confirm',
    KeyP: 'pause', Escape: 'pause', KeyM: 'mute',
  };
  const KEYMAP_KEY = {
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
    ' ': 'confirm', enter: 'confirm', p: 'pause', escape: 'pause', m: 'mute',
  };

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const a = KEYMAP[e.code] || KEYMAP_KEY[(e.key || '').toLowerCase()];
    if (!a) return;
    e.preventDefault();
    audioInit();
    if (e.repeat) return;
    action(a);
  }

  let pointer = null;
  function onPointerDown(e) {
    if (e.pointerType === 'touch') game.isTouch = true;
    audioInit();
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (e.pointerType === 'touch') e.preventDefault();
  }
  function onPointerUp(e) {
    if (!pointer || pointer.id !== e.pointerId) return;
    const sx = pointer.x, sy = pointer.y;
    pointer = null;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (HH.ui && typeof HH.ui.hitMute === 'function') {
      let hit = false;
      safe('ui.hitMute', () => { hit = !!HH.ui.hitMute(sx, sy); });
      if (hit) { toggleMute(); return; }
    }
    if (Math.hypot(dx, dy) < 24) { action('tap'); return; }
    if (Math.abs(dx) > Math.abs(dy)) action(dx > 0 ? 'right' : 'left');
    else action(dy < 0 ? 'up' : 'down');
  }

  // ================================================================ CANVAS / LOOP

  const canvas = document.getElementById('game') || (() => {
    const c = document.createElement('canvas'); c.id = 'game'; document.body.appendChild(c); return c;
  })();
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    if (HH.render && typeof HH.render.resize === 'function') safe('render.resize', () => HH.render.resize(W, H));
  }

  let lastTs = 0;
  function frame(ts) {
    requestAnimationFrame(frame); // schedule first so an exception never stops the loop
    let dt = resetClock ? 0 : (ts - lastTs) / 1000;
    resetClock = false;
    lastTs = ts;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);

    if (!game.paused && dt > 0) safe('update', () => update(dt));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = (HH.PAL && HH.PAL.grassA) || '#9fe3a6';
    ctx.fillRect(0, 0, W, H);
    if (HH.render && typeof HH.render.draw === 'function') safe('render.draw', () => HH.render.draw(ctx, game));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (HH.ui && typeof HH.ui.draw === 'function') safe('ui.draw', () => HH.ui.draw(ctx, game, W, H));
  }

  function boot() {
    resize();
    resetWorld();
    game.state = 'title';
    if (HH.audio && typeof HH.audio.setMuted === 'function') safe('audio.setMuted', () => HH.audio.setMuted(game.muted));

    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', () => { pointer = null; });
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    canvas.addEventListener('touchstart', stop, { passive: false });
    canvas.addEventListener('touchmove', stop, { passive: false });
    canvas.addEventListener('touchend', stop, { passive: false });
    canvas.addEventListener('contextmenu', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); else resetClock = true; });
    window.addEventListener('blur', () => setPaused(true));
    window.addEventListener('focus', () => { resetClock = true; });

    resetClock = true;
    requestAnimationFrame(frame);
  }

  // ================================================================ DEBUG HOOK

  window.__hop = {
    game,
    // press('up'|'down'|'left'|'right'|'space'|'enter'|'p'|'escape'|'m'|'tap')
    press(k) {
      const key = String(k).toLowerCase();
      const map = { space: 'confirm', ' ': 'confirm', enter: 'confirm', confirm: 'confirm', p: 'pause', escape: 'pause', esc: 'pause',
        pause: 'pause', m: 'mute', mute: 'mute', tap: 'tap', w: 'up', a: 'left', s: 'down', d: 'right' };
      action(DIRS[key] ? key : (map[key] || key));
    },
    // advance the simulation manually (ignores pause): step(dt=1/60, n=1)
    step(dt, n) { dt = dt || 1 / 60; n = n || 1; for (let i = 0; i < n; i++) update(Math.min(dt, 0.05)); },
    newRun,
    get scrollFloor() { return scrollFloor; },
    get queue() { return inputQueue.slice(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
