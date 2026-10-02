// Hop Hop — an endless lane-hopping toy diorama starring Blip the robot.
// Plain canvas 2D, Web Audio, no assets, no build step.
(() => {
  'use strict';

  // ---------- constants ----------
  const MINC = -4, MAXC = 4;          // playable columns (inclusive)
  const XMIN = -20, SPAN = 40;        // wrap range for moving objects
  const HOP_T = 0.14;                 // seconds per hop
  const TRAIN_SPEED = 24;             // tiles per second
  const LOG_Z = 0.04, LOG_H = 0.26;
  const ELEV = { grass: 0.14, road: 0, river: -0.16, rail: 0.05 };
  const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  const CANDY = ['#ff6b8b', '#ffb547', '#5cc8ff', '#b28cff', '#ff8fd1', '#4fdca0', '#ffd84d', '#ff7a59'];
  const CARGO = ['#fff4e0', '#e9f3ff', '#ffe7ef', '#efffe9'];
  const TREE_GREENS = [['#7fd67a', '#4fae5d'], ['#62c98a', '#3d9e66'], ['#a3dc6b', '#74b045']];
  const FONT = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Varela Round", "Trebuchet MS", system-ui, sans-serif';
  const HEADLINES = { car: 'BONK!', train: 'CHOO CHOO!', water: 'SPLASH!', grab: 'SNATCHED!' };
  const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  // ---------- utils ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (a, n) => ((a % n) + n) % n;
  const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  function hash(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const shadeCache = new Map();
  function shade(hex, f) {
    const key = hex + f;
    let c = shadeCache.get(key);
    if (c) return c;
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    c = `rgb(${r | 0},${g | 0},${b | 0})`;
    shadeCache.set(key, c);
    return c;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ---------- canvas & projection ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 1, H = 1, DPR = 1, S = 60, RS = 47, HS = 37, OY = 400;
  let camX = 0, camY = 0, shakeX = 0, shakeY = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    S = Math.max(22, Math.min(W / 9.5, H / 10));   // tile width in px
    RS = S * 0.78;                                   // row depth in px (foreshortened)
    HS = S * 0.62;                                   // one unit of height in px
    OY = clamp(H - 4.8 * RS, H * 0.55, H * 0.8);     // screen y of the camera's focus row
    if (lanes) ensureLanes();
  }

  const X = x => W / 2 + (x - camX) * S + shakeX;
  const Y = (y, z = 0) => OY - (y - camY) * RS - z * HS + shakeY;
  const uiScale = () => clamp(Math.min(W, H) / 720, 0.55, 1.5);
  const deathRows = () => Math.min((H - OY) / RS - 0.6, 4.2);

  function rr(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function ellipse(x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
  }
  // A chunky block in screen pixels: (cx, cy) is the ground center of the footprint.
  // Draws the visible front (south) face in `side`, then the lighter top face.
  function boxPx(cx, cy, w, d, h, z, top, side, r) {
    const x0 = cx - w / 2, y0 = cy - d / 2 - z - h, y1 = cy + d / 2 - z;
    ctx.fillStyle = side; rr(x0, y0, w, y1 - y0, r); ctx.fill();
    ctx.fillStyle = top; rr(x0, y0, w, d, r); ctx.fill();
  }
  // Same block, in world units (tiles / rows / height units).
  function box(x, y, w, d, h, z, top, side, r = 0.08) {
    boxPx(X(x), Y(y), w * S, d * RS, h * HS, z * HS, top, side, r * S);
  }
  function shadow(x, y, z, w, d, a = 0.2) {
    ctx.fillStyle = `rgba(28,40,70,${a})`;
    ellipse(X(x), Y(y - 0.04, z), w * S / 2, d * RS / 2);
    ctx.fill();
  }
  function star(x, y, s, color, alpha) {
    if (s <= 0.2) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---------- sound ----------
  const Sound = {
    ctx: null, master: null, noiseBuf: null,
    muted: store.get('hophop.muted', '0') === '1',
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ctx = new AC(); } catch (e) { return; }
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },
    ok() { return this.ctx && this.ctx.state === 'running' && !this.muted; },
    setMuted(m) {
      this.muted = m;
      store.set('hophop.muted', m ? '1' : '0');
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
    },
    tone(f, dur, o = {}) {
      if (!this.ok()) return;
      const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(f, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t0 + (o.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },
    hiss(dur, o = {}) {
      if (!this.ok()) return;
      const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = o.filter || 'lowpass';
      f.frequency.setValueAtTime(o.freq || 1000, t0);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
      f.Q.value = o.q || 0.7;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t0 + (o.attack || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t0, Math.random() * 0.4);
      src.stop(t0 + dur + 0.03);
    },
    hop() { const p = rand(0.94, 1.08); this.tone(380 * p, 0.09, { type: 'square', vol: 0.045, to: 720 * p }); this.tone(760 * p, 0.06, { type: 'triangle', vol: 0.05, to: 1100 * p }); },
    bump() { this.tone(170, 0.09, { type: 'triangle', vol: 0.14, to: 110 }); },
    coin() { this.tone(988, 0.09, { type: 'square', vol: 0.045 }); this.tone(1319, 0.24, { type: 'square', vol: 0.045, delay: 0.07 }); this.tone(2637, 0.2, { vol: 0.04, delay: 0.07 }); },
    splash() { this.hiss(0.55, { freq: 2600, to: 280, vol: 0.32 }); this.tone(320, 0.28, { to: 90, vol: 0.12 }); },
    hit() { this.hiss(0.35, { filter: 'bandpass', freq: 3200, to: 600, q: 1, vol: 0.4 }); this.tone(230, 0.38, { type: 'sawtooth', to: 50, vol: 0.12 }); this.tone(1300, 0.14, { type: 'square', to: 2600, vol: 0.04, delay: 0.03 }); },
    bell() { this.tone(1480, 0.2, { type: 'triangle', vol: 0.07 }); this.tone(1975, 0.12, { vol: 0.025 }); },
    train() { this.hiss(1.3, { freq: 420, to: 120, vol: 0.22, attack: 0.15 }); this.tone(311, 0.65, { type: 'sawtooth', vol: 0.04, attack: 0.03 }); this.tone(370, 0.65, { type: 'sawtooth', vol: 0.04, attack: 0.03 }); },
    grab() { this.tone(1500, 0.45, { type: 'sawtooth', to: 480, vol: 0.05 }); this.hiss(0.4, { filter: 'highpass', freq: 3000, vol: 0.07 }); },
    start() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, { type: 'square', vol: 0.045, delay: i * 0.07 })); },
    over() { [523, 415, 330].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.1, delay: 0.25 + i * 0.14 })); },
    best() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, { type: 'square', vol: 0.04, delay: 0.75 + i * 0.08 })); },
  };
  function toggleMute() { Sound.init(); Sound.setMuted(!Sound.muted); }

  // ---------- game state ----------
  let lanes = null;
  let genRow = 0, pathCol = 0, chunkType = 'grass', chunkLeft = 0, lastRoadDir = 1, lastRiverDir = 1;
  let state = 'title';               // title | playing | dying | over
  let paused = false;
  let time = 0, realTime = 0;
  let score = 0, coins = 0, best = parseInt(store.get('hophop.best', '0'), 10) || 0;
  let newBest = false, started = false;
  let deathKind = '', deathT = 0, overT = 0, shake = 0, scorePop = 0, coinPop = 0;
  let particles = [], popups = [];
  const hawk = { t: 0 };
  const player = {
    x: 0, y: 0, z: 0, row: 0, hopping: false, hp: 0,
    fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, trow: 0, dx: 0,
    facing: 'up', sq: 0, sqv: 0, ant: 5, blink: 0, blinkT: 2,
    queued: null, alive: true, visible: true, alpha: 1,
  };

  // ---------- world generation ----------
  const difficulty = row => clamp((row - 4) / 180, 0, 1);

  function chooseType(row) {
    if (row <= 3) return 'grass';
    if (chunkLeft <= 0) {
      const d = difficulty(row);
      const opts = [
        ['grass', 0.28 - 0.06 * d],
        ['road', 0.36 + 0.04 * d],
        ['river', row > 8 ? 0.2 + 0.05 * d : 0],
        ['rail', row > 14 ? 0.12 + 0.08 * d : 0],
      ].filter(o => o[0] !== chunkType && o[1] > 0);
      let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
      let type = opts[opts.length - 1][0];
      for (const o of opts) { r -= o[1]; if (r <= 0) { type = o[0]; break; } }
      chunkType = type;
      if (type === 'grass') chunkLeft = randi(1, 2);
      else if (type === 'road') chunkLeft = randi(1, 2 + Math.round(3 * d));
      else if (type === 'river') chunkLeft = randi(1, d < 0.25 ? 2 : 3);
      else chunkLeft = randi(1, d > 0.3 ? 2 : 1);
    }
    chunkLeft--;
    return chunkType;
  }

  function makeLane(row) {
    const prev = lanes.get(row - 1);
    const type = chooseType(row);
    const d = difficulty(row);
    const lane = { row, type, d, elev: ELEV[type], dir: 1, speed: 0, objs: [], trees: new Map(), coin: null };
    if (type === 'grass') genGrass(lane, prev, d);
    else if (type === 'road') genRoad(lane, d);
    else if (type === 'river') genRiver(lane, d);
    else genRail(lane, d);
    if (type !== 'grass' && row > 2 && Math.random() < (type === 'river' ? 0 : 0.13)) lane.coin = { x: randi(MINC, MAXC), taken: false };
    return lane;
  }

  function makeTree() {
    const g = pick(TREE_GREENS);
    return Math.random() < 0.15
      ? { kind: 'rock', s: rand(0.8, 1) }
      : { kind: 'tree', tiers: randi(1, 3), top: g[0], side: g[1] };
  }

  // Grass keeps a guaranteed open "path column": it is free in this row and the previous
  // grass row, and the next path column is adjacent and also free, so consecutive grass
  // strips can never wall the player in. Non-grass lanes have no static obstacles.
  function genGrass(lane, prev, d) {
    const row = lane.row;
    for (let c = -14; c <= 14; c++) {
      if (c >= MINC && c <= MAXC) continue;
      if (Math.abs(c) === MAXC + 1 || Math.random() < 0.5) lane.trees.set(c, makeTree());
    }
    if (row < 0) {
      for (let c = MINC; c <= MAXC; c++) if (Math.random() < (row < -2 ? 0.45 : 0.15)) lane.trees.set(c, makeTree());
      return;
    }
    const afterWater = prev && prev.type === 'river';
    const prevGrass = prev && prev.type === 'grass' && prev.row >= 0;
    const oldPc = row === 0 ? 0 : prevGrass ? pathCol : randi(MINC + 1, MAXC - 1);
    const newPc = clamp(oldPc + randi(-1, 1), MINC, MAXC);
    pathCol = newPc;
    const p = row <= 3 ? 0.07 : 0.1 + 0.22 * d;
    const maxTrees = afterWater ? 2 : row <= 3 ? 2 : 4 + Math.round(2 * d);
    const cols = [];
    for (let c = MINC; c <= MAXC; c++) cols.push(c);
    cols.sort(() => Math.random() - 0.5);
    let n = 0;
    for (const c of cols) {
      if (c === oldPc || c === newPc) continue;
      if (row === 0 && Math.abs(c) <= 1) continue;
      if (n < maxTrees && Math.random() < p) { lane.trees.set(c, makeTree()); n++; }
    }
    if (row > 2 && Math.random() < 0.24) {
      const free = cols.filter(c => !lane.trees.has(c));
      if (free.length) lane.coin = { x: pick(free), taken: false };
    }
  }

  function genRoad(lane, d) {
    lane.dir = Math.random() < 0.65 ? -lastRoadDir : lastRoadDir;
    lastRoadDir = lane.dir;
    lane.speed = rand(1.2, 2.1) * (1 + 1.1 * d);
    // Gaps are wide enough in *time* that there is always a safe window to hop through.
    const minGap = Math.max(2.6, lane.speed * 0.8);
    let p = rand(0, 3);
    for (;;) {
      const truck = Math.random() < 0.2 + 0.15 * d;
      const w = truck ? 2.3 : 1.3;
      if (p + w + minGap > SPAN) break;
      const color = pick(CANDY);
      const cargo = pick(CARGO);
      lane.objs.push({
        x: XMIN + p + w / 2, w, kind: truck ? 'truck' : 'car', color,
        top: shade(color, 0.25), side: shade(color, -0.2),
        cargoTop: cargo, cargoSide: shade(cargo, -0.18),
      });
      p += w + minGap + rand(0, Math.max(1, 6 - 3 * d));
    }
  }

  function genRiver(lane, d) {
    lane.dir = -lastRiverDir;            // stacked rivers alternate direction
    lastRiverDir = lane.dir;
    lane.speed = rand(0.9, 1.4) * (1 + 0.5 * d);
    const maxGap = 2.2 + 1.3 * d;        // gaps stay short so a log always comes by
    const items = [];
    let total = 0;
    while (total < SPAN) {
      const w = pick(d < 0.4 ? [2, 3, 3, 4] : [2, 2, 3, 3, 4]);
      const gap = rand(1.2, maxGap);
      items.push({ w, gap });
      total += w + gap;
    }
    const cut = (total - SPAN) / items.length;
    let p = rand(0, 1);
    for (const it of items) {
      lane.objs.push({ x: XMIN + p + it.w / 2, w: it.w, ph: rand(0, 6.28), seed: randi(0, 9999) });
      p += it.w + Math.max(0.35, it.gap - cut);
    }
  }

  function genRail(lane, d) {
    lane.dir = Math.random() < 0.5 ? -1 : 1;
    lane.phase = 'idle';
    lane.timer = rand(1, 5);
    lane.cars = randi(3, 5);
    lane.trainLen = lane.cars * 3.2 - 0.2;
    lane.trainX = 0;
    lane.trainEnd = 0;
    lane.bellT = 0;
  }

  function ensureLanes() {
    const top = Math.ceil(camY + OY / RS) + 8;
    while (genRow <= top) { lanes.set(genRow, makeLane(genRow)); genRow++; }
    const minKeep = Math.floor(camY - (H - OY) / RS) - 6;
    for (const r of lanes.keys()) if (r < minKeep) lanes.delete(r);
  }

  function resetWorld() {
    lanes = new Map();
    genRow = -14; pathCol = 0; chunkType = 'grass'; chunkLeft = 0;
    lastRoadDir = Math.random() < 0.5 ? 1 : -1; lastRiverDir = 1;
    Object.assign(player, {
      x: 0, y: 0, z: ELEV.grass, row: 0, hopping: false, hp: 0, dx: 0, facing: 'down',
      sq: 0, sqv: 0, ant: 5, queued: null, alive: true, visible: true, alpha: 1, blink: 0, blinkT: 2,
    });
    camY = 0; camX = 0; score = 0; coins = 0; newBest = false; started = false;
    particles = []; popups = []; shake = 0; deathKind = ''; deathT = 0; hawk.t = 0;
    ensureLanes();
  }

  // ---------- lanes update ----------
  function updateLanes(dt) {
    for (const lane of lanes.values()) {
      if (lane.type === 'road' || lane.type === 'river') {
        const v = lane.dir * lane.speed * dt;
        for (const o of lane.objs) {
          o.x += v;
          if (lane.dir > 0 && o.x - o.w / 2 > XMIN + SPAN) o.x -= SPAN;
          else if (lane.dir < 0 && o.x + o.w / 2 < XMIN) o.x += SPAN;
        }
      } else if (lane.type === 'rail') {
        updateRail(lane, dt);
      }
    }
  }

  function updateRail(lane, dt) {
    const near = state === 'playing' && lane.row - player.y > -5 && lane.row - player.y < 9;
    if (lane.phase === 'idle') {
      lane.timer -= dt;
      if (lane.timer <= 0) { lane.phase = 'warn'; lane.timer = 1.5 - 0.4 * lane.d; lane.bellT = 0; }
    } else if (lane.phase === 'warn') {
      lane.timer -= dt;
      lane.bellT -= dt;
      if (lane.bellT <= 0) { if (near) Sound.bell(); lane.bellT = 0.42; }
      if (lane.timer <= 0) {
        lane.phase = 'pass';
        const half = W / (2 * S) + Math.abs(camX) + 3;
        lane.trainEnd = half + lane.trainLen / 2;
        lane.trainX = -lane.dir * lane.trainEnd;
        if (near) Sound.train();
      }
    } else {
      lane.trainX += lane.dir * TRAIN_SPEED * dt;
      if (lane.dir * lane.trainX > lane.trainEnd) {
        lane.phase = 'idle';
        lane.timer = rand(2.5, 7) * (1 - 0.35 * lane.d);
      }
    }
  }

  function logAt(lane, x, tol) {
    let bestLog = null, bestDist = Infinity;
    for (const o of lane.objs) {
      const out = Math.abs(x - o.x) - o.w / 2;
      if (out <= tol && out < bestDist) { bestDist = out; bestLog = o; }
    }
    return bestLog;
  }
  const logBob = o => Math.sin(time * 2.4 + o.ph) * 0.025;
  const logTop = lane => lane.elev + LOG_Z + LOG_H;

  // ---------- player ----------
  function tryMove(dir) {
    if (state !== 'playing' || paused || !player.alive) return;
    if (player.hopping) { player.queued = dir; return; }
    const [dx, dy] = DIRS[dir];
    player.facing = dir;
    const toRow = player.row + dy;
    const toLane = lanes.get(toRow);
    let tx = player.x + dx;
    if (!toLane || toLane.type !== 'river') tx = Math.round(tx);
    if (!toLane || tx < MINC - 0.45 || tx > MAXC + 0.45) return bump();
    if (toLane.type === 'grass' && toLane.trees.has(Math.round(tx))) return bump();
    Object.assign(player, {
      hopping: true, hp: 0, fx: player.x, fy: player.y, fz: player.z,
      tx, ty: toRow, trow: toRow, dx, ant: 0,
      tz: toLane.type === 'river' ? logTop(toLane) : toLane.elev,
    });
    started = true;
    Sound.hop();
  }

  function bump() {
    player.sq = -0.14; player.sqv = 0; player.ant = 0.15;
    Sound.bump();
  }

  function updatePlayer(dt) {
    if (player.hopping) {
      player.hp = Math.min(1, player.hp + dt / HOP_T);
      // Hopping onto / off of logs: carry the endpoints with the current so landings line up.
      const tl = lanes.get(player.trow), fl = lanes.get(player.row);
      if (tl && tl.type === 'river') player.tx += tl.dir * tl.speed * dt;
      if (fl && fl.type === 'river') player.fx += fl.dir * fl.speed * dt;
      const p = player.hp;
      player.x = lerp(player.fx, player.tx, p);
      player.y = lerp(player.fy, player.ty, p);
      player.z = lerp(player.fz, player.tz, p) + Math.sin(Math.PI * p) * 0.5;
      if (p >= 1) land();
      return;
    }
    const lane = lanes.get(player.row);
    if (lane && lane.type === 'river') {
      const log = logAt(lane, player.x, 0.12);
      if (!log) return die('water');
      player.x += lane.dir * lane.speed * dt;
      player.z = logTop(lane) + logBob(log);
      if (player.x < MINC - 0.6 || player.x > MAXC + 0.6) die('water');
    }
  }

  function land() {
    player.hopping = false;
    player.x = player.tx; player.y = player.ty; player.row = player.trow;
    player.sq = -0.3; player.sqv = 0;
    const lane = lanes.get(player.row);
    if (lane.type === 'river') {
      // Forgiving landing: snap onto a log if we're within a little of its edge.
      const log = logAt(lane, player.x, 0.38);
      if (!log) { player.z = lane.elev; return die('water'); }
      player.x = clamp(player.x, log.x - log.w / 2 + 0.28, log.x + log.w / 2 - 0.28);
      player.z = logTop(lane) + logBob(log);
      spawnDrops(player.x, player.y, lane.elev + 0.05, 5, 1.6);
    } else {
      player.z = lane.elev;
      spawnDust(player.x, player.y, lane.elev);
    }
    if (player.row > score) { score = player.row; scorePop = 1; }
    if (lane.coin && !lane.coin.taken && Math.abs(lane.coin.x - player.x) < 0.55) collectCoin(lane);
    if (player.queued) { const q = player.queued; player.queued = null; tryMove(q); }
  }

  function collectCoin(lane) {
    lane.coin.taken = true;
    coins++;
    coinPop = 1;
    const z = lane.elev + 0.35;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      addP({ type: 'star', x: lane.coin.x, y: lane.row, z, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.2, vz: rand(1, 2.5), life: rand(0.4, 0.6), drag: 3, color: i % 2 ? '#fff7c2' : '#ffd23f' });
    }
    popups.push({ x: lane.coin.x, y: lane.row, z: z + 0.4, text: '+1', life: 0.8, max: 0.8 });
    Sound.coin();
  }

  function checkCollisions() {
    const r = player.hopping ? (player.hp > 0.5 ? player.trow : player.row) : player.row;
    const lane = lanes.get(r);
    if (!lane) return;
    if (lane.type === 'road') {
      for (const o of lane.objs) if (Math.abs(o.x - player.x) < o.w / 2 + 0.2) return die('car');
    } else if (lane.type === 'rail' && lane.phase === 'pass') {
      if (Math.abs(lane.trainX - player.x) < lane.trainLen / 2 + 0.25) die('train');
    }
  }

  function die(kind) {
    if (!player.alive) return;
    player.alive = false;
    player.hopping = false;
    player.queued = null;
    state = 'dying';
    deathKind = kind;
    deathT = 0;
    if (kind === 'car' || kind === 'train') {
      player.visible = false;
      burst(player.x, player.y, player.z + 0.4);
      shake = kind === 'train' ? 1 : 0.7;
      Sound.hit();
    } else if (kind === 'water') {
      const lane = lanes.get(player.row);
      splash(player.x, player.y, lane ? lane.elev + 0.03 : 0);
      Sound.splash();
    } else {
      hawk.t = 0;
      Sound.grab();
    }
  }

  function updateDying(dt) {
    deathT += dt;
    if (deathKind === 'water') {
      player.z -= dt * 0.9;
      player.alpha = Math.max(0, 1 - deathT * 2.4);
    } else if (deathKind === 'grab') {
      hawk.t += dt;
      if (hawk.t > 0.55 && hawk.t - dt <= 0.55) { shake = 0.35; spawnDust(player.x, player.y, player.z, 8); }
    }
    if (deathT >= (deathKind === 'grab' ? 2.0 : 1.3)) gameOver();
  }

  function gameOver() {
    state = 'over';
    overT = 0;
    if (score > best) {
      best = score;
      newBest = true;
      store.set('hophop.best', best);
      Sound.best();
    }
    Sound.over();
  }

  function startGame() { if (!player.alive) resetWorld(); state = 'playing'; Sound.start(); }
  function restart() { resetWorld(); state = 'playing'; Sound.start(); }

  function updateRobotAnim(dt) {
    player.sqv += (-200 * player.sq - 15 * player.sqv) * dt;
    player.sq = clamp(player.sq + player.sqv * dt, -0.4, 0.4);
    player.ant += dt;
    player.blinkT -= dt;
    if (player.blink > 0) player.blink -= dt;
    if (player.blinkT <= 0) {
      player.blink = 0.13;
      player.blinkT = Math.random() < 0.2 ? 0.25 : rand(2, 5);
    }
  }

  // ---------- particles ----------
  function addP(p) {
    p.max = p.life;
    if (p.gz === undefined) p.gz = p.z;
    p.rot = p.rot || 0;
    if (particles.length < 600) particles.push(p);
  }
  function spawnDust(x, y, z, n = 7) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3), sp = rand(0.7, 1.4);
      addP({ type: 'dust', x, y, z: z + 0.03, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, vz: rand(0.15, 0.45), life: rand(0.35, 0.55), size: rand(0.07, 0.12), drag: 5, color: '#fffaf0' });
    }
  }
  function spawnDrops(x, y, z, n, power) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(0.4, 1.4) * power * 0.6;
      addP({ type: 'drop', x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: rand(1.5, 3.2) * power, g: 14, gz: z - 0.05, life: 1.2 });
    }
  }
  function splash(x, y, z) {
    addP({ type: 'ring', x, y, z, vx: 0, vy: 0, vz: 0, life: 0.8, size: 1.1 });
    addP({ type: 'ring', x, y, z, vx: 0, vy: 0, vz: 0, life: 1.1, size: 1.7 });
    spawnDrops(x, y, z, 18, 1.5);
  }
  function burst(x, y, z) {
    const sparkCols = ['#fff3a0', '#ffd23f', '#ff9f43', '#7ffcff'];
    for (let i = 0; i < 30; i++) {
      addP({ type: 'spark', x, y, z, vx: rand(-5, 5), vy: rand(-3, 3), vz: rand(1.5, 7), g: 16, gz: -9, life: rand(0.35, 0.8), color: pick(sparkCols) });
    }
    const ground = z - 0.4;
    for (let i = 0; i < 12; i++) {
      addP({
        type: i < 5 ? 'nut' : i < 9 ? 'bolt' : 'panel', x, y, z,
        vx: rand(-2.6, 2.6), vy: rand(-1.8, 1.8), vz: rand(3, 6.5), g: 15, gz: ground, bounce: 0.45,
        life: rand(1.4, 1.9), vr: rand(-14, 14), rot: rand(0, 6),
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2);
      addP({ type: 'dust', x, y, z: z - 0.2, vx: Math.cos(a) * 1.5, vy: Math.sin(a), vz: rand(0.4, 1), life: rand(0.5, 0.8), size: rand(0.12, 0.18), drag: 3, color: '#dfe6f0' });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles[i] = particles[particles.length - 1]; particles.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.g) {
        p.vz -= p.g * dt;
        if (p.z < p.gz) {
          if (p.bounce) {
            p.z = p.gz; p.vz = -p.vz * p.bounce; p.vx *= 0.55; p.vy *= 0.55; p.vr *= 0.6;
            if (Math.abs(p.vz) < 0.6) { p.vz = 0; p.g = 0; p.vx = 0; p.vy = 0; p.vr = 0; }
          } else if (p.type === 'drop') {
            p.life = 0;
          }
        }
      }
      if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; p.vz *= f; }
      if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.life -= dt;
      p.z += dt * 1.4;
      if (p.life <= 0) popups.splice(i, 1);
    }
  }

  // ---------- main update ----------
  function update(dt) {
    time += dt;
    updateLanes(dt);
    if (state === 'playing') {
      updatePlayer(dt);
      if (player.alive) checkCollisions();
      if (player.alive && started) {
        camY += (0.42 + 0.48 * Math.min(1, score / 220)) * dt;   // the world keeps creeping forward
        if (player.y < camY - deathRows()) die('grab');
      }
    } else if (state === 'dying') {
      updateDying(dt);
    } else if (state === 'over') {
      overT += dt;
    }
    if ((state === 'playing' || state === 'title') && player.y > camY) {
      camY += (player.y - camY) * (1 - Math.exp(-dt * 3));
    }
    camX += (player.x * 0.15 - camX) * (1 - Math.exp(-dt * 4));
    updateRobotAnim(dt);
    updateParticles(dt);
    shake = Math.max(0, shake - dt * 1.8);
    scorePop = Math.max(0, scorePop - dt * 4);
    coinPop = Math.max(0, coinPop - dt * 4);
    ensureLanes();
  }

  // ---------- drawing: ground ----------
  function visibleCols() {
    const half = W / (2 * S);
    return [Math.floor(camX - half) - 2, Math.ceil(camX + half) + 2];
  }

  function drawGround(lane) {
    const r = lane.row, e = lane.elev;
    const yTop = Y(r + 0.5, e), yBot = Y(r - 0.5, e);
    const south = lanes.get(r - 1);
    const es = south ? south.elev : e;
    let top, side;
    if (lane.type === 'grass') { top = (r & 1) ? '#aee8b4' : '#c3ef9e'; side = '#7fbe6a'; }
    else if (lane.type === 'road') { top = '#3f434f'; side = '#2b2e37'; }
    else if (lane.type === 'river') { top = '#1f8c8f'; side = '#16696d'; }
    else { top = '#b9a08a'; side = '#8d7562'; }
    ctx.fillStyle = top;
    ctx.fillRect(0, Math.floor(yTop), W, Math.ceil(yBot - yTop) + 1);
    if (e > es) {
      ctx.fillStyle = side;
      ctx.fillRect(0, yBot, W, Y(r - 0.5, es) - yBot + 1);
    }
    const [c0, c1] = visibleCols();

    if (lane.type === 'grass') {
      const k = S / 60;
      ctx.fillStyle = (r & 1) ? '#8fd395' : '#9fd67f';
      ctx.beginPath();
      for (let c = c0; c <= c1; c++) {
        for (let j = 0; j < 2; j++) {
          const h = hash(c * 3 + j, r);
          if (h > 0.55) continue;
          const px = X(c + (hash(c + 11, r * 5 + j) - 0.5) * 0.8);
          const py = Y(r + (hash(c * 7 + j, r + 3) - 0.5) * 0.7, e);
          ctx.rect(px - 4 * k, py - 5 * k, 2 * k, 5 * k);
          ctx.rect(px - 1 * k, py - 8 * k, 2 * k, 8 * k);
          ctx.rect(px + 2 * k, py - 6 * k, 2 * k, 6 * k);
        }
      }
      ctx.fill();
      for (let c = c0; c <= c1; c++) {
        const h = hash(c, r * 13 + 1);
        if (h < 0.93 || lane.trees.has(c)) continue;
        const px = X(c + (hash(c, r) - 0.5) * 0.6), py = Y(r + (hash(r, c) - 0.5) * 0.5, e);
        ctx.fillStyle = h > 0.965 ? '#fff6f0' : '#ffb3c7';
        ellipse(px, py - 2 * k, 3.2 * k, 2.4 * k); ctx.fill();
        ctx.fillStyle = '#ffd84d';
        ellipse(px, py - 2 * k, 1.2 * k, 1 * k); ctx.fill();
      }
    } else if (lane.type === 'road') {
      const north = lanes.get(r + 1);
      if (north && north.type === 'road') {
        ctx.fillStyle = '#f2e3bd';
        const yy = Y(r + 0.5, e), th = Math.max(2, S * 0.055);
        for (let x = c0; x <= c1; x++) ctx.fillRect(X(x + 0.1), yy - th / 2, S * 0.5, th);
      } else {
        ctx.fillStyle = '#555a68';
        ctx.fillRect(0, yTop, W, Math.max(2, RS * 0.06));
      }
      if (!south || south.type !== 'road') {
        ctx.fillStyle = '#4a4e5b';
        ctx.fillRect(0, yBot - Math.max(2, RS * 0.06), W, Math.max(2, RS * 0.06));
      }
    } else if (lane.type === 'river') {
      ctx.fillStyle = '#197a7e';
      ctx.fillRect(0, yTop, W, RS * 0.14);
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, S * 0.04);
      for (let i = 0; i < 26; i++) {
        const hx = hash(i, r), hy = hash(r, i + 50);
        const x = XMIN + mod(hx * SPAN + time * lane.speed * 0.45 * lane.dir, SPAN);
        if (x < c0 - 1 || x > c1 + 1) continue;
        const y = r + (hy - 0.5) * 0.7, len = 0.16 + hx * 0.16;
        ctx.globalAlpha = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(time * 2.2 + i * 1.7));
        const py = Y(y, e);
        ctx.beginPath();
        ctx.moveTo(X(x - len / 2), py);
        ctx.quadraticCurveTo(X(x), py - S * 0.04, X(x + len / 2), py);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      const flashing = lane.phase !== 'idle' && Math.floor(time * 4) % 2 === 0;
      for (let x = c0; x <= c1; x += 0.5) box(x, r, 0.18, 0.8, 0.04, e, '#7a5238', '#5a3a26', 0.02);
      const midX = (c0 + c1) / 2, wide = c1 - c0 + 2;
      for (const off of [0.22, -0.22]) box(midX, r + off, wide, 0.07, 0.07, e + 0.04, '#d98d58', '#8d4a2a', 0);
      if (flashing) {
        ctx.fillStyle = 'rgba(255,176,40,0.13)';
        ctx.fillRect(0, yTop, W, yBot - yTop);
      }
    }
  }

  // ---------- drawing: objects ----------
  function drawTree(x, y, z, tr) {
    if (tr.kind === 'rock') {
      const s = tr.s;
      shadow(x, y, z, 0.85 * s, 0.7 * s, 0.2);
      box(x, y, 0.72 * s, 0.6 * s, 0.36 * s, z, '#dedbd3', '#a8a49b', 0.14);
      box(x - 0.08, y + 0.05, 0.34 * s, 0.3 * s, 0.14 * s, z + 0.36 * s, '#ece9e2', '#b9b5ac', 0.08);
      return;
    }
    shadow(x, y, z, 0.95, 0.8, 0.2);
    box(x, y, 0.26, 0.26, 0.36, z, '#b07c52', '#7a5034', 0.04);
    let zz = z + 0.32;
    for (let i = 0; i < tr.tiers; i++) {
      const w = 0.84 - i * 0.16;
      box(x, y, w, w * 0.88, 0.42, zz, tr.top, tr.side, 0.1);
      zz += 0.42;
    }
  }

  function drawCoin(lane) {
    const c = lane.coin;
    const z = lane.elev + 0.32 + Math.sin(time * 3 + c.x) * 0.06;
    shadow(c.x, lane.row, lane.elev, 0.42, 0.32, 0.16);
    const cx = X(c.x), cy = Y(lane.row, z), r = S * 0.2;
    const spin = Math.cos(time * 2.6 + c.x * 1.3), rx = Math.max(r * 0.16, r * Math.abs(spin));
    ctx.fillStyle = '#d18f00';
    ellipse(cx + (spin > 0 ? 1 : -1) * r * 0.07, cy, rx + r * 0.06, r); ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ellipse(cx, cy, rx, r); ctx.fill();
    ctx.fillStyle = '#ffeb8a';
    ellipse(cx, cy, rx * 0.55, r * 0.55); ctx.fill();
    const s = Math.sin(time * 3.3 + c.x * 1.7 + lane.row);
    if (s > 0.55) star(cx + r * 0.75, cy - r * 0.8, r * 0.7 * (s - 0.55) / 0.45, '#ffffff', 1);
    const s2 = Math.sin(time * 2.7 + lane.row * 2.1 + 2);
    if (s2 > 0.7) star(cx - r * 0.8, cy + r * 0.2, r * 0.5 * (s2 - 0.7) / 0.3, '#fff7c2', 1);
  }

  function headlight(px, py, rad, dir) {
    ctx.fillStyle = 'rgba(255,246,176,0.35)';
    ellipse(px + dir * rad * 1.2, py, rad * 2.2, rad * 1.5); ctx.fill();
    ctx.fillStyle = '#fff6b0';
    ellipse(px, py, rad, rad); ctx.fill();
  }

  function drawVehicle(o, lane) {
    const y = lane.row, z = lane.elev, dir = lane.dir;
    shadow(o.x, y, z, o.w + 0.2, 0.86, 0.24);
    for (const s of [-1, 1]) box(o.x + s * (o.w / 2 - 0.32), y - 0.29, 0.28, 0.14, 0.22, z, '#3a3a44', '#22222a', 0.06);
    if (o.kind === 'car') {
      box(o.x, y, o.w, 0.72, 0.32, z + 0.1, o.top, o.side, 0.15);
      const cx = o.x - dir * 0.1;
      box(cx, y + 0.02, 0.72, 0.56, 0.27, z + 0.42, o.top, '#a9dcff', 0.11);
      // window pillar
      ctx.fillStyle = o.side;
      const wy0 = Y(y + 0.02 - 0.28, z + 0.69), wy1 = Y(y + 0.02 - 0.28, z + 0.42);
      ctx.fillRect(X(cx) - S * 0.025, wy0 + (wy1 - wy0) * 0.15, S * 0.05, (wy1 - wy0) * 0.85);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(X(cx - 0.3), wy0 + (wy1 - wy0) * 0.25, S * 0.08, (wy1 - wy0) * 0.5);
      const fy = Y(y - 0.36, z + 0.27);
      headlight(X(o.x + dir * (o.w / 2 - 0.09)), fy, S * 0.05, dir);
      ctx.fillStyle = '#ff4d5e';
      ctx.fillRect(X(o.x - dir * (o.w / 2 - 0.05)) - S * 0.03, fy - S * 0.03, S * 0.06, S * 0.06);
    } else {
      const cabX = o.x + dir * (o.w / 2 - 0.36), cargoX = o.x - dir * 0.38;
      box(cargoX, y, 1.5, 0.78, 0.78, z + 0.1, o.cargoTop, o.cargoSide, 0.1);
      const sy = Y(y - 0.39, z + 0.45);
      ctx.fillStyle = o.color;
      ctx.fillRect(X(cargoX - 0.75) + 2, sy - S * 0.05, S * 1.5 - 4, S * 0.1);
      box(cabX, y, 0.72, 0.74, 0.55, z + 0.1, o.top, o.side, 0.13);
      const gy0 = Y(y - 0.37, z + 0.6), gy1 = Y(y - 0.37, z + 0.4);
      ctx.fillStyle = '#a9dcff';
      rr(X(cabX - 0.24), gy0, S * 0.48, gy1 - gy0, S * 0.04); ctx.fill();
      headlight(X(o.x + dir * (o.w / 2 - 0.08)), Y(y - 0.37, z + 0.24), S * 0.05, dir);
    }
  }

  function drawLog(o, lane) {
    const y = lane.row, z = lane.elev + LOG_Z + logBob(o);
    ctx.fillStyle = 'rgba(8,60,70,0.3)';
    ellipse(X(o.x), Y(y - 0.06, lane.elev), (o.w / 2 + 0.1) * S, 0.4 * RS); ctx.fill();
    box(o.x, y, o.w, 0.62, LOG_H, z, '#c58a56', '#8f5a32', 0.13);
    // bark grain on top
    ctx.strokeStyle = 'rgba(128,78,40,0.55)';
    ctx.lineWidth = Math.max(1, S * 0.025);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const gy = Y(y + 0.18 - i * 0.18, z + LOG_H), off = hash(o.seed, i) * 0.6;
      ctx.moveTo(X(o.x - o.w / 2 + 0.3 + off), gy);
      ctx.lineTo(X(o.x + o.w / 2 - 0.3 - hash(i, o.seed) * 0.6), gy);
    }
    ctx.stroke();
    // ring ends
    const yA = Y(y + 0.31, z + LOG_H), yB = Y(y - 0.31, z);
    const cy = (yA + yB) / 2, ry = (yB - yA) / 2 * 0.92, rx = S * 0.12;
    for (const s of [-1, 1]) {
      const ex = X(o.x + s * o.w / 2) - s * rx * 0.7;
      ctx.fillStyle = '#efcb94'; ellipse(ex, cy, rx, ry); ctx.fill();
      ctx.strokeStyle = '#b98955'; ctx.lineWidth = Math.max(1, S * 0.02);
      ellipse(ex, cy, rx * 0.66, ry * 0.66); ctx.stroke();
      ellipse(ex, cy, rx * 0.32, ry * 0.32); ctx.stroke();
      // water foam at the ends
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ellipse(ex + s * rx * 0.6, Y(y - 0.2, lane.elev), rx * 0.9, rx * 0.35); ctx.fill();
    }
  }

  function drawSignal(x, lane) {
    const y = lane.row + 0.36, z = lane.elev;
    shadow(x, y, z, 0.3, 0.2, 0.2);
    box(x, y, 0.1, 0.1, 1.25, z, '#eef0f5', '#a9aab5', 0.03);
    // crossbuck
    const cx = X(x), cy = Y(y - 0.05, z + 1.12), L = S * 0.22;
    ctx.lineCap = 'round';
    for (const [lw, col] of [[S * 0.075, '#b8323c'], [S * 0.05, '#ffffff']]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(cx - L, cy - L * 0.6); ctx.lineTo(cx + L, cy + L * 0.6);
      ctx.moveTo(cx - L, cy + L * 0.6); ctx.lineTo(cx + L, cy - L * 0.6);
      ctx.stroke();
    }
    box(x, y, 0.5, 0.14, 0.22, z + 0.72, '#3a3d48', '#262833', 0.05);
    const active = lane.phase !== 'idle';
    const on = Math.floor(time * 4) % 2 === 0;
    const ly = Y(y - 0.07, z + 0.83), lr = S * 0.065;
    for (const s of [-1, 1]) {
      const lit = active && (s < 0 ? on : !on);
      const lx = X(x + s * 0.13);
      if (lit) {
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr * 5);
        g.addColorStop(0, 'rgba(255,190,60,0.7)');
        g.addColorStop(1, 'rgba(255,190,60,0)');
        ctx.fillStyle = g;
        ellipse(lx, ly, lr * 5, lr * 5); ctx.fill();
      }
      ctx.fillStyle = lit ? '#ffc23d' : '#5b4a3c';
      ellipse(lx, ly, lr, lr); ctx.fill();
    }
  }

  function drawTrain(lane) {
    const y = lane.row, z = lane.elev + 0.06, dir = lane.dir;
    const front = lane.trainX + dir * lane.trainLen / 2;
    const [c0, c1] = visibleCols();
    shadow(lane.trainX, y, lane.elev, lane.trainLen + 0.3, 0.95, 0.25);
    for (let i = 0; i < lane.cars; i++) {
      const cx = front - dir * (i * 3.2 + 1.5);
      if (cx + 1.6 < c0 || cx - 1.6 > c1) continue;
      box(cx, y, 3.0, 0.84, 1.0, z + 0.08, '#ff6168', '#c7343f', 0.15);
      box(cx, y + 0.02, 2.6, 0.5, 0.08, z + 1.08, '#ff8a8f', '#d9535b', 0.06);
      const fy0 = Y(y - 0.42, z + 0.95), fy1 = Y(y - 0.42, z + 0.08);
      const fh = fy1 - fy0;
      ctx.fillStyle = '#fff0d6';
      const wins = i === 0 ? 2 : 4;
      for (let k = 0; k < wins; k++) {
        const wx = i === 0 ? cx - dir * (0.2 + k * 0.6) : cx - 1.1 + k * 0.6;
        rr(X(wx) - S * 0.2, fy0 + fh * 0.18, S * 0.4, fh * 0.32, S * 0.05); ctx.fill();
      }
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(X(cx - 1.5) + 2, fy0 + fh * 0.66, S * 3 - 4, fh * 0.09);
      ctx.fillStyle = '#2a2a33';
      for (const s of [-1, 1]) { rr(X(cx + s * 1.0) - S * 0.25, fy1 - fh * 0.12, S * 0.5, fh * 0.16, S * 0.05); ctx.fill(); }
      if (i === 0) {
        ctx.fillStyle = '#8f1f2a';
        ctx.fillRect(X(front - dir * 0.35) - S * 0.12, fy0 + fh * 0.15, S * 0.24, fh * 0.45);
        headlight(X(front - dir * 0.08), fy0 + fh * 0.5, S * 0.075, dir);
      }
    }
  }

  function drawLaneObjects(lane) {
    const [c0, c1] = visibleCols();
    const r = lane.row;
    if (lane.type === 'grass') {
      for (let c = c0; c <= c1; c++) {
        const tr = lane.trees.get(c);
        if (tr) drawTree(c, r, lane.elev, tr);
      }
      if (lane.coin && !lane.coin.taken) drawCoin(lane);
    } else if (lane.type === 'road') {
      if (lane.coin && !lane.coin.taken) drawCoin(lane);
      for (const o of lane.objs) if (o.x + o.w > c0 && o.x - o.w < c1) drawVehicle(o, lane);
    } else if (lane.type === 'river') {
      for (const o of lane.objs) if (o.x + o.w > c0 && o.x - o.w < c1) drawLog(o, lane);
    } else {
      drawSignal(MINC - 0.85, lane);
      drawSignal(MAXC + 0.85, lane);
      if (lane.coin && !lane.coin.taken) drawCoin(lane);
      if (lane.phase === 'pass') drawTrain(lane);
    }
  }

  // ---------- drawing: robot ----------
  function drawRobotAt(gx, gy, lift, sx, sy, facing, alpha, tilt, wob) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(gx, gy - lift);
    if (tilt) ctx.rotate(tilt);
    ctx.scale(sx, sy);
    const B = (x, y, w, d, h, z, top, side, r) => boxPx(x * S, -y * RS, w * S, d * RS, h * HS, z * HS, top, side, r * S);
    // feet & arms
    B(-0.14, 0, 0.16, 0.24, 0.1, 0, '#62708e', '#444f69', 0.04);
    B(0.14, 0, 0.16, 0.24, 0.1, 0, '#62708e', '#444f69', 0.04);
    B(-0.31, 0.02, 0.1, 0.2, 0.2, 0.13, '#b4c4dd', '#7f93b4', 0.04);
    B(0.31, 0.02, 0.1, 0.2, 0.2, 0.13, '#b4c4dd', '#7f93b4', 0.04);
    // body + chest panel
    B(0, 0, 0.52, 0.42, 0.3, 0.08, '#c5d5ec', '#8a9fc2', 0.08);
    const bf0 = 0.21 * RS - 0.38 * HS, bf1 = 0.21 * RS - 0.08 * HS, bh = bf1 - bf0;
    ctx.fillStyle = '#6f84aa';
    rr(-0.13 * S, bf0 + bh * 0.22, 0.26 * S, bh * 0.56, 0.04 * S); ctx.fill();
    ctx.fillStyle = Math.sin(time * 5) > 0 ? '#7ffcff' : '#3fb7c8';
    ellipse(0.06 * S, bf0 + bh * 0.5, 0.03 * S, 0.03 * S); ctx.fill();
    ctx.fillStyle = '#ffcf4d';
    ellipse(-0.05 * S, bf0 + bh * 0.5, 0.025 * S, 0.025 * S); ctx.fill();
    // head
    B(0, 0, 0.6, 0.48, 0.4, 0.38, '#e4ecf8', '#a6b8d6', 0.1);
    const hf0 = 0.24 * RS - 0.78 * HS, hf1 = 0.24 * RS - 0.38 * HS, hm = (hf0 + hf1) / 2, hh = hf1 - hf0;
    // rivets
    ctx.fillStyle = '#8a9fc2';
    for (const s of [-1, 1]) { ellipse(s * 0.24 * S, hf0 + hh * 0.22, 0.022 * S, 0.022 * S); ctx.fill(); }
    if (facing === 'up') {
      ctx.fillStyle = '#8a9fc2';
      for (let i = -1; i <= 1; i++) { rr(-0.15 * S, hm + i * hh * 0.24 - 0.015 * S, 0.3 * S, 0.03 * S, 0.015 * S); ctx.fill(); }
      ctx.fillStyle = 'rgba(127,252,255,0.9)';
      ellipse(0.2 * S, hf1 - hh * 0.2, 0.025 * S, 0.025 * S); ctx.fill();
    } else {
      const ex = facing === 'left' ? -0.14 * S : facing === 'right' ? 0.14 * S : 0;
      const open = player.blink > 0 ? 0.12 : 1;
      ctx.fillStyle = '#26304d';
      rr(ex - 0.15 * S, hm - hh * 0.36, 0.3 * S, hh * 0.72, hh * 0.3); ctx.fill();
      const g = ctx.createRadialGradient(ex, hm, 0, ex, hm, 0.34 * S);
      g.addColorStop(0, `rgba(127,252,255,${0.55 * (0.4 + 0.6 * open)})`);
      g.addColorStop(1, 'rgba(127,252,255,0)');
      ctx.fillStyle = g;
      ellipse(ex, hm, 0.34 * S, 0.34 * S); ctx.fill();
      ctx.fillStyle = '#8ffcff';
      ellipse(ex, hm, 0.075 * S, Math.max(0.6, 0.075 * S * open)); ctx.fill();
      if (open > 0.5) {
        ctx.fillStyle = '#ffffff';
        ellipse(ex - 0.025 * S, hm - 0.025 * S, 0.022 * S, 0.022 * S); ctx.fill();
      }
    }
    // antenna
    const ay = -0.78 * HS, len = 0.36 * S;
    const tx = Math.sin(wob) * len, ty = ay - Math.cos(wob) * len;
    ctx.strokeStyle = '#7d8fb0';
    ctx.lineWidth = Math.max(1.5, 0.045 * S);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, ay);
    ctx.quadraticCurveTo(Math.sin(wob * 0.4) * len * 0.5, ay - len * 0.55, tx, ty);
    ctx.stroke();
    ctx.fillStyle = '#8a9fc2';
    ellipse(0, ay, 0.06 * S, 0.035 * S); ctx.fill();
    const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 0.16 * S);
    tg.addColorStop(0, 'rgba(255,214,90,0.6)');
    tg.addColorStop(1, 'rgba(255,214,90,0)');
    ctx.fillStyle = tg;
    ellipse(tx, ty, 0.16 * S, 0.16 * S); ctx.fill();
    ctx.fillStyle = '#ffcf4d';
    ellipse(tx, ty, 0.065 * S, 0.065 * S); ctx.fill();
    ctx.fillStyle = '#fff6d0';
    ellipse(tx - 0.02 * S, ty - 0.02 * S, 0.02 * S, 0.02 * S); ctx.fill();
    ctx.restore();
  }

  function antennaWobble() {
    const a = player.ant;
    let w = Math.sin(a * 22) * 0.55 * Math.exp(-a * 4.5) + Math.sin(time * 1.7) * 0.05;
    if (player.hopping) w -= player.dx * 0.35 * Math.sin(Math.PI * player.hp) + 0.25 * Math.sin(Math.PI * player.hp);
    return w;
  }

  function drawPlayer() {
    if (!player.visible || (!player.alive && deathKind === 'grab' && hawk.t > 0.55)) return;
    const groundZ = player.hopping ? lerp(player.fz, player.tz, player.hp) : player.z;
    const air = Math.max(0, player.z - groundZ);
    const k = 1 - Math.min(0.45, air * 0.9);
    if (player.alpha > 0.3) shadow(player.x, player.y, groundZ, 0.66 * k, 0.5 * k, 0.26 * k);
    const hopS = player.hopping ? Math.sin(Math.PI * player.hp) : 0;
    const breath = player.hopping ? 1 : 1 + Math.sin(time * 3) * 0.015;
    const sy = (1 + player.sq) * (1 + 0.22 * hopS) * breath;
    const sx = (1 - player.sq * 0.7) * (1 - 0.12 * hopS);
    drawRobotAt(X(player.x), Y(player.y), player.z * HS, sx, sy, player.facing, player.alpha, player.dx * hopS * 0.12, antennaWobble());
  }

  // ---------- drawing: hawk ("the Snatcher") ----------
  function hawkPos() {
    const tx = X(player.x), ty = Y(player.y, player.z) - S * 0.5;
    const t = hawk.t;
    if (t < 0.55) {
      const k = t / 0.55, e = 1 - Math.pow(1 - k, 3);
      return [lerp(tx + W * 0.55, tx, e), lerp(-S * 2.5, ty - S * 0.55, e)];
    }
    const u = Math.max(0, t - 0.7) / 1.2;
    return [tx - u * u * W * 1.1, ty - S * 0.55 - u * u * (H + S * 4)];
  }

  function drawHawk() {
    const [hx, hy] = hawkPos();
    const t = hawk.t;
    if (t < 0.7) {
      const k = Math.min(1, t / 0.55);
      ctx.fillStyle = `rgba(28,40,70,${0.25 * k})`;
      ellipse(X(player.x), Y(player.y, player.z), S * 0.9 * k, RS * 0.45 * k); ctx.fill();
    }
    if (t > 0.55) {
      drawRobotAt(hx, hy + S * 0.95, 0, 1, 1, 'down', 1, Math.sin(time * 7) * 0.18, Math.sin(time * 14) * 0.4);
    }
    const flap = Math.sin(time * 18);
    const k = S / 60;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(k * 1.2, k * 1.2);
    ctx.fillStyle = '#5e4f9a';
    ctx.beginPath();
    ctx.moveTo(-4, -6); ctx.lineTo(30, -6 - 44 * flap); ctx.lineTo(58, -14 - 30 * flap); ctx.lineTo(18, 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6b5aa6';
    ctx.beginPath();
    ctx.moveTo(32, -8); ctx.lineTo(60, -20); ctx.lineTo(62, 4); ctx.lineTo(32, 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a7bd1';
    rr(-30, -16, 66, 30, 14); ctx.fill();
    ctx.fillStyle = '#c9c0f2';
    rr(-24, 0, 50, 12, 6); ctx.fill();
    ctx.fillStyle = '#9d8fe0';
    rr(-52, -26, 32, 28, 10); ctx.fill();
    ctx.fillStyle = '#ffb020';
    ctx.beginPath(); ctx.moveTo(-50, -15); ctx.lineTo(-68, -8); ctx.lineTo(-50, -3); ctx.closePath(); ctx.fill();
    const g = ctx.createRadialGradient(-40, -14, 0, -40, -14, 14);
    g.addColorStop(0, 'rgba(255,77,109,0.7)'); g.addColorStop(1, 'rgba(255,77,109,0)');
    ctx.fillStyle = g; ellipse(-40, -14, 14, 14); ctx.fill();
    ctx.fillStyle = '#ff4d6d'; ellipse(-40, -14, 4.5, 4.5); ctx.fill();
    ctx.strokeStyle = '#c7cbd6'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const cx of [-8, 10]) { ctx.moveTo(cx, 12); ctx.lineTo(cx, 26); ctx.lineTo(cx - 6, 32); }
    ctx.stroke();
    ctx.fillStyle = '#a597ea';
    ctx.beginPath();
    ctx.moveTo(-10, -8); ctx.lineTo(16, -8); ctx.lineTo(44, -12 - 58 * flap); ctx.lineTo(4, -10 - 46 * flap);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------- drawing: particles ----------
  function drawParticles() {
    for (const p of particles) {
      const k = 1 - p.life / p.max;
      const px = X(p.x), py = Y(p.y, p.z);
      switch (p.type) {
        case 'dust': {
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.fillStyle = p.color;
          const r = p.size * S * (0.5 + k * 1.1);
          ellipse(px, py, r, r * 0.85); ctx.fill();
          break;
        }
        case 'spark': {
          ctx.globalAlpha = Math.min(1, p.life * 3);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(2, S * 0.055);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - p.vx * S * 0.05, py + (p.vy * RS + p.vz * HS) * 0.05);
          ctx.stroke();
          break;
        }
        case 'nut': case 'bolt': case 'panel': {
          ctx.globalAlpha = Math.min(1, p.life * 3);
          ctx.fillStyle = 'rgba(28,40,70,0.18)';
          ellipse(X(p.x), Y(p.y, p.gz), S * 0.07, RS * 0.05); ctx.fill();
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(p.rot);
          const s = S * 0.085;
          if (p.type === 'nut') {
            ctx.fillStyle = '#cdd5e2';
            ctx.beginPath();
            for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#5d6a85'; ellipse(0, 0, s * 0.42, s * 0.42); ctx.fill();
          } else if (p.type === 'bolt') {
            ctx.fillStyle = '#9aa6bb'; ctx.fillRect(-s * 0.3, -s * 0.2, s * 0.6, s * 2);
            ctx.fillStyle = '#d7deea'; ctx.fillRect(-s * 0.75, -s * 0.7, s * 1.5, s * 0.6);
          } else {
            ctx.fillStyle = '#c5d5ec'; ctx.fillRect(-s * 1.1, -s * 0.8, s * 2.2, s * 1.6);
            ctx.fillStyle = '#8a9fc2'; ctx.fillRect(-s * 1.1, s * 0.3, s * 2.2, s * 0.5);
          }
          ctx.restore();
          break;
        }
        case 'drop':
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#dff8ff';
          ellipse(px, py, S * 0.045, S * 0.055); ctx.fill();
          break;
        case 'ring': {
          ctx.globalAlpha = (1 - k) * 0.85;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(1, S * 0.06 * (1 - k));
          const r = (0.15 + k * p.size) * S;
          ellipse(px, py, r, r * RS / S * 0.8); ctx.stroke();
          break;
        }
        case 'star':
          star(px, py, S * 0.12 * (1 - k * 0.6), p.color, 1 - k);
          break;
      }
    }
    ctx.globalAlpha = 1;
    for (const p of popups) {
      text(p.text, X(p.x), Y(p.y, p.z), Math.max(16, S * 0.38), { color: '#ffe066', alpha: Math.min(1, p.life / p.max * 2) });
    }
  }

  // ---------- drawing: UI ----------
  function text(str, x, y, size, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || 900} ${size}px ${FONT}`;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(25,35,75,0.38)';
    ctx.shadowBlur = size * 0.2;
    ctx.shadowOffsetY = size * 0.09;
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = 'rgba(38,52,96,0.5)';
    ctx.strokeText(str, x, y);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = o.color || '#ffffff';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function muteRect() {
    const s = Math.max(40, 46 * uiScale());
    return { x: W - s - 14, y: 14, w: s, h: s };
  }
  const inMute = (x, y) => { const m = muteRect(); return x >= m.x - 8 && x <= m.x + m.w + 8 && y >= m.y - 8 && y <= m.y + m.h + 8; };

  function drawMute() {
    const m = muteRect(), k = m.w / 46;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.scale(k, k);
    ctx.shadowColor = 'rgba(25,35,75,0.38)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(8, 18); ctx.lineTo(16, 18); ctx.lineTo(26, 9); ctx.lineTo(26, 37); ctx.lineTo(16, 28); ctx.lineTo(8, 28);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    if (Sound.muted) {
      ctx.moveTo(31, 17); ctx.lineTo(41, 29); ctx.moveTo(41, 17); ctx.lineTo(31, 29);
    } else {
      ctx.arc(27, 23, 7, -0.9, 0.9);
      ctx.moveTo(27 + 13 * Math.cos(-0.9), 23 + 13 * Math.sin(-0.9));
      ctx.arc(27, 23, 13, -0.9, 0.9);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawHUD() {
    const u = uiScale();
    if (state !== 'title') {
      const sz = 58 * u;
      ctx.save();
      ctx.translate(22 * u + 6, 48 * u);
      const pop = 1 + scorePop * 0.22;
      ctx.scale(pop, pop);
      text(String(score), 0, 0, sz, { align: 'left' });
      ctx.restore();
      text('BEST ' + Math.max(best, score), 24 * u + 6, 48 * u + 46 * u, 20 * u, { align: 'left', weight: 800, color: '#f3fbff' });
    }
    const m = muteRect();
    const cy = m.y + m.h / 2, cx = m.x - 26 * u;
    const cr = 13 * u * (1 + coinPop * 0.3);
    ctx.fillStyle = '#d18f00'; ellipse(cx + 1.5 * u, cy + 1.5 * u, cr, cr); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ellipse(cx, cy, cr, cr); ctx.fill();
    ctx.fillStyle = '#ffeb8a'; ellipse(cx, cy, cr * 0.55, cr * 0.55); ctx.fill();
    text(String(coins), cx - 22 * u, cy + 1, 30 * u, { align: 'right', color: '#fff3c4' });
    drawMute();
  }

  function drawTitle() {
    const u = uiScale();
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.6);
    g.addColorStop(0, 'rgba(40,60,120,0.32)');
    g.addColorStop(1, 'rgba(40,60,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.6);
    const title = 'HOP HOP';
    const size = Math.min(W * 0.17, H * 0.15, 150);
    ctx.font = `900 ${size}px ${FONT}`;
    const widths = [...title].map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = W / 2 - total / 2;
    const ty = H * 0.2;
    [...title].forEach((ch, i) => {
      const bob = Math.sin(realTime * 3.2 - i * 0.55) * size * 0.07;
      ctx.save();
      ctx.translate(x + widths[i] / 2, ty + bob);
      ctx.rotate(Math.sin(realTime * 2.4 - i * 0.7) * 0.05);
      text(ch, 0, 0, size, { color: ch === 'O' ? '#8ffcff' : '#ffffff' });
      ctx.restore();
      x += widths[i];
    });
    text('a tiny robot named Blip, hopping as far as it can', W / 2, ty + size * 0.75, Math.max(14, 22 * u), { weight: 800, color: '#f3fbff' });
    if (best > 0) text('BEST ' + best, W / 2, ty + size * 0.75 + 36 * u, 24 * u, { weight: 800, color: '#ffe066' });
    const py = Math.max(H * 0.86, Math.min(H - 70 * u, OY + RS * 1.4));
    const pulse = 0.65 + 0.35 * Math.sin(realTime * 4);
    text(IS_TOUCH ? 'TAP TO START' : 'PRESS SPACE TO START', W / 2, py, Math.max(20, 34 * u), { alpha: pulse });
    text(IS_TOUCH ? 'tap to hop · swipe to turn' : 'arrows / WASD to hop · M to mute · P to pause', W / 2, py + 40 * u, Math.max(13, 18 * u), { weight: 800, color: '#f3fbff' });
  }

  function drawGameOver() {
    const u = uiScale();
    ctx.fillStyle = `rgba(28,38,80,${Math.min(0.3, overT * 0.8)})`;
    ctx.fillRect(0, 0, W, H);
    const pop = easeOutBack(Math.min(1, overT * 3));
    const hs = Math.min(W * 0.13, H * 0.12, 110);
    ctx.save();
    ctx.translate(W / 2, H * 0.24);
    ctx.scale(pop, pop);
    ctx.rotate(Math.sin(realTime * 2) * 0.03);
    text(HEADLINES[deathKind] || 'OOPS!', 0, 0, hs, { color: '#ffffff' });
    ctx.restore();
    const p2 = easeOutBack(clamp((overT - 0.15) * 3, 0, 1));
    ctx.save();
    ctx.translate(W / 2, H * 0.4);
    ctx.scale(p2, p2);
    text('SCORE', 0, -hs * 0.45, 24 * u, { weight: 800, color: '#f3fbff' });
    text(String(score), 0, hs * 0.25, hs * 0.95, { color: '#ffffff' });
    ctx.restore();
    const p3 = easeOutBack(clamp((overT - 0.3) * 3, 0, 1));
    ctx.save();
    ctx.translate(W / 2, H * 0.4 + hs * 1.15);
    ctx.scale(p3, p3);
    if (newBest) {
      ctx.rotate(Math.sin(realTime * 6) * 0.06);
      text('NEW BEST!', 0, 0, 34 * u, { color: '#ffe066' });
    } else {
      text('BEST ' + best, 0, 0, 30 * u, { color: '#ffe066' });
    }
    ctx.restore();
    if (coins > 0) text(`+${coins} coin${coins === 1 ? '' : 's'}`, W / 2, H * 0.4 + hs * 1.15 + 44 * u, 22 * u, { weight: 800, color: '#fff3c4', alpha: clamp((overT - 0.4) * 3, 0, 1) });
    if (overT > 0.45) {
      const pulse = 0.65 + 0.35 * Math.sin(realTime * 4);
      text(IS_TOUCH ? 'TAP TO PLAY AGAIN' : 'PRESS SPACE TO PLAY AGAIN', W / 2, H * 0.8, Math.max(20, 34 * u), { alpha: pulse });
    }
  }

  function drawPaused() {
    const u = uiScale();
    ctx.fillStyle = 'rgba(28,38,80,0.35)';
    ctx.fillRect(0, 0, W, H);
    text('PAUSED', W / 2, H * 0.42, Math.min(W * 0.14, 110), {});
    text(IS_TOUCH ? 'tap to resume' : 'press any key to resume', W / 2, H * 0.42 + 70 * u, 26 * u, { weight: 800, color: '#f3fbff', alpha: 0.7 + 0.3 * Math.sin(realTime * 4) });
  }

  function drawDanger() {
    if (state !== 'playing' || !started) return;
    const dz = player.y - (camY - deathRows());
    if (dz > 1.6) return;
    const a = (1 - dz / 1.6) * 0.4 * (0.65 + 0.35 * Math.sin(realTime * 10));
    const g = ctx.createLinearGradient(0, H, 0, H * 0.6);
    g.addColorStop(0, `rgba(255,70,90,${a})`);
    g.addColorStop(1, 'rgba(255,70,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.6, W, H * 0.4);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (shake > 0 && !paused) {
      shakeX = (Math.random() - 0.5) * shake * S * 0.3;
      shakeY = (Math.random() - 0.5) * shake * S * 0.3;
    } else { shakeX = 0; shakeY = 0; }
    ctx.fillStyle = '#b4eaa0';
    ctx.fillRect(0, 0, W, H);
    const top = Math.ceil(camY + OY / RS) + 4;
    const bottom = Math.floor(camY - (H - OY) / RS) - 1;
    const pRow = Math.round(player.y);
    for (let r = top; r >= bottom; r--) {
      const lane = lanes.get(r);
      if (!lane) continue;
      drawGround(lane);
      drawLaneObjects(lane);
      if (r === pRow) drawPlayer();
    }
    // out-of-bounds tint so the playable strip reads clearly
    ctx.fillStyle = 'rgba(30,45,90,0.16)';
    const l = X(MINC - 0.5), rgt = X(MAXC + 0.5);
    if (l > 0) ctx.fillRect(0, 0, l, H);
    if (rgt < W) ctx.fillRect(rgt, 0, W - rgt, H);
    drawParticles();
    if (state === 'dying' && deathKind === 'grab') drawHawk();
    drawDanger();
    if (state === 'title') drawTitle();
    drawHUD();
    if (state === 'over') drawGameOver();
    if (paused) drawPaused();
  }

  // ---------- input ----------
  function pause() {
    if ((state === 'playing' || state === 'dying') && !paused) {
      paused = true;
      touch = null;
      if (Sound.ctx && Sound.ctx.state === 'running') Sound.ctx.suspend().catch(() => {});
    }
  }
  function resume() { paused = false; Sound.init(); }

  window.addEventListener('keydown', e => {
    const dir = KEYMAP[e.code];
    const action = e.code === 'Space' || e.code === 'Enter';
    if (dir || action) e.preventDefault();
    if (e.key === 'Meta' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.metaKey || e.ctrlKey) return;
    Sound.init();
    if (e.code === 'KeyM') { if (!e.repeat) toggleMute(); return; }
    if (e.repeat) return;
    if (paused) { resume(); return; }
    if ((e.code === 'KeyP' || e.code === 'Escape') && state === 'playing') { pause(); return; }
    if (state === 'title') {
      if (dir || action) { startGame(); if (dir) tryMove(dir); }
    } else if (state === 'playing') {
      if (dir) tryMove(dir);
    } else if (state === 'over' && action && overT > 0.45) {
      restart();
    }
  });

  function pointerAction(dir) {
    if (paused) return resume();
    if (state === 'title') startGame();
    else if (state === 'playing') tryMove(dir);
    else if (state === 'over' && overT > 0.45) restart();
  }

  let touch = null;
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    Sound.init();
    const t = e.changedTouches[0];
    if (inMute(t.clientX, t.clientY)) { toggleMute(); touch = null; return; }
    touch = { x: t.clientX, y: t.clientY, id: t.identifier };
  }, { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (!touch) return;
    let t = null;
    for (const c of e.changedTouches) if (c.identifier === touch.id) t = c;
    if (!t) return;
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    let dir = 'up';
    if (Math.hypot(dx, dy) > 24) dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    pointerAction(dir);
  }, { passive: false });
  canvas.addEventListener('touchcancel', () => { touch = null; });
  canvas.addEventListener('mousedown', e => {
    Sound.init();
    if (inMute(e.clientX, e.clientY)) return toggleMute();
    pointerAction('up');
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', resize);

  // ---------- loop ----------
  let last = performance.now();
  let errored = false;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 1 / 30);    // big gaps (tab switches, hitches) never teleport anything
    realTime += dt;
    try {
      if (!paused) update(dt);
      render();
    } catch (err) {
      if (!errored) { errored = true; console.error(err); }
    }
    requestAnimationFrame(frame);
  }

  resize();
  resetWorld();
  requestAnimationFrame(frame);

  // Small read-only debug handle (used for automated checks).
  window.__hophop = {
    get state() { return state; }, get paused() { return paused; }, get score() { return score; },
    get coins() { return coins; }, get camY() { return camY; }, get errored() { return errored; }, get deathKind() { return deathKind; },
    player, lanes: () => lanes, tryMove, startGame, restart, resetWorld,
    step(dt, n = 1) { for (let i = 0; i < n; i++) update(dt); render(); },
    // Generates `rows` lanes and verifies a walkable route exists through every grass
    // stretch: BFS over columns, where non-grass lanes are open in every column.
    checkPaths(rows = 3000) {
      resetWorld();
      for (let r = genRow; r < rows; r++) { lanes.set(genRow, makeLane(genRow)); genRow++; }
      let reach = new Set([0]);
      const stats = { grass: 0, road: 0, river: 0, rail: 0 };
      for (let r = 1; r < rows; r++) {
        const lane = lanes.get(r);
        stats[lane.type]++;
        if (lane.type === 'road' || lane.type === 'river') {
          // circular gaps between consecutive objects (edge to edge)
          const xs = lane.objs.map(o => [mod(o.x - o.w / 2 - XMIN, SPAN), o.w]).sort((a, b) => a[0] - b[0]);
          for (let i = 0; i < xs.length; i++) {
            const nx = i + 1 < xs.length ? xs[i + 1][0] : xs[0][0] + SPAN;
            const gap = nx - (xs[i][0] + xs[i][1]);
            const key = lane.type === 'road' ? 'minCarGapSeconds' : 'logGap';
            const v = lane.type === 'road' ? gap / lane.speed : gap;
            stats[key + 'Min'] = Math.min(stats[key + 'Min'] ?? Infinity, v);
            if (lane.type === 'river') stats.logGapMax = Math.max(stats.logGapMax ?? 0, v);
          }
        }
        if (lane.type !== 'grass') { reach = new Set(); for (let c = MINC; c <= MAXC; c++) reach.add(c); continue; }
        const next = new Set();
        const queue = [...reach].filter(c => !lane.trees.has(c));
        queue.forEach(c => next.add(c));
        while (queue.length) {
          const c = queue.pop();
          for (const n of [c - 1, c + 1]) if (n >= MINC && n <= MAXC && !lane.trees.has(n) && !next.has(n)) { next.add(n); queue.push(n); }
        }
        if (!next.size) { resetWorld(); return { ok: false, blockedAt: r, stats }; }
        reach = next;
      }
      resetWorld();
      return { ok: true, stats };
    },
  };
})();
