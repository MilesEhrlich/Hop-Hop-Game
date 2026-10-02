// HOP-HOP renderer: low-poly toy diorama drawn with canvas 2D boxes.
// Exposes HH.render = { resize, sx, sy, TW, TD, HS, W, H, visibleRange, draw }.
(function () {
  'use strict';
  const HH = (window.HH = window.HH || {});
  const R = (HH.render = HH.render || {});

  // ---------------------------------------------------------------------------
  // Projection state
  // ---------------------------------------------------------------------------
  let TW = 48, TD = 37.44, HS = 29.76, W = 0, H = 0;
  let camX = 4.5, camRow = 0, shX = 0, shY = 0;
  let C = null; // current ctx during draw

  function syncCam() {
    const g = HH.game;
    if (g && g.cam) {
      camX = +g.cam.x || 0;
      camRow = +g.cam.row || 0;
    }
  }

  function sx(x) { return (x - camX) * TW + W * 0.5 + shX; }
  function sy(row, z) { return H * 0.64 - (row - camRow) * TD - (z || 0) * HS + shY; }

  // ---------------------------------------------------------------------------
  // Color helpers (memoized)
  // ---------------------------------------------------------------------------
  const shadeCache = new Map();
  function shade(hex, amt) {
    const key = hex + '|' + amt;
    let v = shadeCache.get(key);
    if (v) return v;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    v = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
    shadeCache.set(key, v);
    return v;
  }

  const HILITE = 'rgba(255,255,255,0.30)';
  const WINDOW = '#2c3550';
  const WHEEL = '#2a2b33';
  const HEAD = '#fff6c2';
  const TAIL = '#ff4f5e';
  const OOB = 'rgba(28,36,64,0.22)';
  const OOB_EDGE = 'rgba(28,36,64,0.16)';
  const BG = '#8fd59a';

  // ---------------------------------------------------------------------------
  // Cached sprites
  // ---------------------------------------------------------------------------
  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  let shadowSpr = null;
  const glowSpr = {};
  let vignette = null;

  function getShadow() {
    if (shadowSpr) return shadowSpr;
    const c = mkCanvas(64, 64), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(30,38,60,0.42)');
    g.addColorStop(0.55, 'rgba(30,38,60,0.30)');
    g.addColorStop(1, 'rgba(30,38,60,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return (shadowSpr = c);
  }
  function getGlow(name, rgb) {
    if (glowSpr[name]) return glowSpr[name];
    const c = mkCanvas(64, 64), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(' + rgb + ',0.9)');
    g.addColorStop(0.35, 'rgba(' + rgb + ',0.45)');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return (glowSpr[name] = c);
  }
  function buildVignette() {
    if (typeof document === 'undefined' || !W || !H) return;
    const vw = Math.max(2, Math.ceil(W / 2)), vh = Math.max(2, Math.ceil(H / 2));
    const c = mkCanvas(vw, vh), x = c.getContext('2d');
    const r0 = Math.min(vw, vh) * 0.42, r1 = Math.hypot(vw / 2, vh / 2) * 1.08;
    const g = x.createRadialGradient(vw / 2, vh * 0.48, r0, vw / 2, vh * 0.48, r1);
    g.addColorStop(0, 'rgba(255,190,120,0)');
    g.addColorStop(0.7, 'rgba(190,110,60,0.08)');
    g.addColorStop(1, 'rgba(140,70,40,0.24)');
    x.fillStyle = g;
    x.fillRect(0, 0, vw, vh);
    vignette = c;
  }

  // ---------------------------------------------------------------------------
  // Resize / visible range
  // ---------------------------------------------------------------------------
  function resize(cssW, cssH) {
    W = Math.max(1, cssW | 0 || cssW);
    H = Math.max(1, cssH | 0 || cssH);
    TW = Math.max(W / 30, Math.min(W / 10.5, H / 11.5));
    TD = 0.78 * TW;
    HS = 0.62 * TW;
    R.TW = TW; R.TD = TD; R.HS = HS; R.W = W; R.H = H;
    buildVignette();
  }

  const vr = { minRow: 0, maxRow: 0, minX: 0, maxX: 0 };
  function visibleRange() {
    syncCam();
    const rowBottom = camRow + (H * 0.64 - H) / TD;
    const rowTop = camRow + (H * 0.64) / TD;
    vr.minRow = Math.floor(rowBottom) - 2;
    vr.maxRow = Math.ceil(rowTop) + 3;
    vr.minX = camX - W / 2 / TW - 1;
    vr.maxX = camX + W / 2 / TW + 1;
    return vr;
  }

  // ---------------------------------------------------------------------------
  // Primitive drawing
  // ---------------------------------------------------------------------------
  function rrPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (r <= 0.6) { C.rect(x, y, w, h); return; }
    C.moveTo(x + r, y);
    C.arcTo(x + w, y, x + w, y + h, r);
    C.arcTo(x + w, y + h, x, y + h, r);
    C.arcTo(x, y + h, x, y, r);
    C.arcTo(x, y, x + w, y, r);
    C.closePath();
  }

  // Box from screen coords: xl..xr, top face yt..ym, front face ym..yb.
  function boxS(xl, xr, yt, ym, yb, top, side, rad) {
    const w = xr - xl;
    if (w <= 0) return;
    if (rad > 0) {
      C.fillStyle = side; C.beginPath(); rrPath(xl, yt, w, yb - yt, rad); C.fill();
      C.fillStyle = top; C.beginPath(); rrPath(xl, yt, w, ym - yt, rad); C.fill();
    } else {
      C.fillStyle = side; C.fillRect(xl, ym, w, yb - ym);
      C.fillStyle = top; C.fillRect(xl, yt, w, ym - yt + 0.5);
    }
    const hl = Math.max(1, TW * 0.018), ins = Math.min(rad || 0, w * 0.3) * 0.6;
    C.fillStyle = HILITE;
    C.fillRect(xl + ins, ym - hl, w - ins * 2, hl);
  }

  // World box.
  function box(x0, x1, r0, r1, z0, z1, top, side, rad) {
    boxS(sx(x0), sx(x1), sy(r1, z1), sy(r0, z1), sy(r0, z0), top, side, rad || 0);
  }

  // Rect on the front (south) face plane at row r between z0..z1.
  function frontRect(x0, x1, r, z0, z1, color, rad) {
    const xl = sx(x0), yt = sy(r, z1);
    C.fillStyle = color;
    if (rad) { C.beginPath(); rrPath(xl, yt, sx(x1) - xl, sy(r, z0) - yt, rad); C.fill(); }
    else C.fillRect(xl, yt, sx(x1) - xl, sy(r, z0) - yt);
  }
  // Rect on a top plane at height z between rows r0..r1.
  function topRect(x0, x1, r0, r1, z, color) {
    const xl = sx(x0), yt = sy(r1, z);
    C.fillStyle = color;
    C.fillRect(xl, yt, sx(x1) - xl, sy(r0, z) - yt);
  }

  function shadow(cx, row, z, wt, dt, a) {
    const w = wt * TW, h = dt * TD;
    if (a <= 0.01) return;
    C.globalAlpha = a;
    C.drawImage(getShadow(), sx(cx) - w / 2, sy(row, z) - h / 2, w, h);
    C.globalAlpha = 1;
  }
  function glow(name, rgb, x, y, rad, a) {
    C.globalAlpha = a;
    C.drawImage(getGlow(name, rgb), x - rad, y - rad, rad * 2, rad * 2);
    C.globalAlpha = 1;
  }
  function star(x, y, s) {
    C.beginPath();
    C.moveTo(x, y - s);
    C.quadraticCurveTo(x, y, x + s, y);
    C.quadraticCurveTo(x, y, x, y + s);
    C.quadraticCurveTo(x, y, x - s, y);
    C.quadraticCurveTo(x, y, x, y - s);
    C.fill();
  }

  function hash(a, b) {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function level(lane) {
    const L = HH.LEVEL || {};
    return lane ? (L[lane.type] || 0) : 0;
  }

  // ---------------------------------------------------------------------------
  // Ground
  // ---------------------------------------------------------------------------
  function drawGrass(lane, r, L, near, x0, x1, c0, c1, t) {
    const P = HH.PAL;
    const yT = sy(r + 1, L), yB = sy(r, L);
    const base = lane.shade ? P.grassB : P.grassA;
    C.fillStyle = base;
    C.fillRect(0, yT, W, yB - yT + 1);
    // subtle checker
    C.fillStyle = 'rgba(255,255,255,0.07)';
    C.beginPath();
    for (let c = c0; c <= c1; c++) {
      if (((c + r) & 1) === 0) { const xl = sx(c); C.rect(xl, yT, TW, yB - yT); }
    }
    C.fill();
    // tufts
    const tf = lane.tufts;
    if (tf && tf.length) {
      C.strokeStyle = lane.shade ? P.tuftB : P.tuftA;
      C.lineWidth = Math.max(1, TW * 0.032);
      C.lineCap = 'round';
      C.beginPath();
      for (let i = 0; i < tf.length; i++) {
        const q = tf[i];
        if (q.x < x0 || q.x > x1) continue;
        const bx = sx(q.x), by = sy(r + q.r, L), s = (q.s || 0.7) * TW;
        const hh = s * 0.13, ww = s * 0.07;
        C.moveTo(bx - ww, by - hh); C.lineTo(bx, by);
        C.lineTo(bx + ww, by - hh);
        C.moveTo(bx, by); C.lineTo(bx + ww * 0.15, by - hh * 1.25);
      }
      C.stroke();
    }
    // painted lip where grass meets road/rail
    if (near && near.type !== 'grass' && near.type !== 'river') {
      const lip = Math.max(2, TD * 0.07);
      C.fillStyle = shade(base, -0.16);
      C.fillRect(0, yB - lip, W, lip);
    }
  }

  function drawRoad(lane, r, L, near, far, c0, c1) {
    const P = HH.PAL;
    const yT = sy(r + 1, L), yB = sy(r, L);
    C.fillStyle = P.road;
    C.fillRect(0, yT, W, yB - yT + 1);
    // faint asphalt tile texture
    C.fillStyle = 'rgba(255,255,255,0.025)';
    C.beginPath();
    for (let c = c0; c <= c1; c++) if (((c + r) & 1) === 0) C.rect(sx(c), yT, TW, yB - yT);
    C.fill();
    const eh = Math.max(2, TD * 0.06);
    C.fillStyle = P.roadEdge;
    if (!far || far.type !== 'road') C.fillRect(0, yT, W, eh);
    if (!near || near.type !== 'road') C.fillRect(0, yB - eh, W, eh);
    if (lane.lineAbove) {
      const lh = Math.max(2, TD * 0.055);
      C.fillStyle = P.laneLine;
      C.beginPath();
      for (let c = c0; c <= c1; c++) {
        const xl = sx(c + 0.22);
        C.rect(xl, yT - lh / 2, TW * 0.56, lh);
      }
      C.fill();
    }
  }

  function drawRiver(lane, r, L, far, x0, x1, t) {
    const P = HH.PAL;
    const yT = sy(r + 1, L), yB = sy(r, L);
    C.fillStyle = P.water;
    C.fillRect(0, yT, W, yB - yT + 1);
    if (!far || far.type !== 'river') {
      C.fillStyle = P.waterDeep;
      C.fillRect(0, yT, W, TD * 0.16);
      C.fillStyle = 'rgba(22,113,120,0.5)';
      C.fillRect(0, yT + TD * 0.16, W, TD * 0.08);
    }
    // ripples
    const rp = lane.ripples;
    if (rp && rp.length) {
      const pad = HH.PAD || 14, cols = HH.COLS || 9;
      const span = cols + pad * 2;
      const drift = (lane.dir || 1) * (lane.speed || 0) * 0.4 * t;
      C.strokeStyle = P.ripple;
      C.lineCap = 'round';
      C.lineWidth = Math.max(1, TW * 0.03);
      for (let i = 0; i < rp.length; i++) {
        const q = rp[i];
        let x = q.x + drift + pad;
        x = ((x % span) + span) % span - pad;
        if (x < x0 || x > x1) continue;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + (q.phase || 0) * 6.283);
        const rx = TW * (0.1 + 0.05 * pulse);
        const cx = sx(x), cy = sy(r + q.r, L);
        C.globalAlpha = 0.35 + 0.65 * pulse;
        C.beginPath();
        C.ellipse(cx, cy, rx, rx * 0.42, 0, Math.PI * 1.12, Math.PI * 1.88);
        C.stroke();
        C.beginPath();
        C.ellipse(cx + rx * 1.3, cy + rx * 0.35, rx * 0.6, rx * 0.26, 0, Math.PI * 1.15, Math.PI * 1.85);
        C.stroke();
      }
      C.globalAlpha = 1;
    }
  }

  function drawRail(lane, r, L, c0, c1) {
    const P = HH.PAL;
    const yT = sy(r + 1, L), yB = sy(r, L);
    C.fillStyle = shade(P.gravel, -0.1);
    C.fillRect(0, yT, W, yB - yT + 1);
    // ballast bed
    const bT = sy(r + 0.9, L), bB = sy(r + 0.1, L);
    C.fillStyle = P.gravel;
    C.fillRect(0, bT, W, bB - bT);
    C.fillStyle = shade(P.gravel, -0.25);
    C.fillRect(0, bB - Math.max(1.5, TD * 0.03), W, Math.max(1.5, TD * 0.03));
    // speckles
    const sd = TW * 0.05;
    C.fillStyle = shade(P.gravel, -0.2);
    C.beginPath();
    for (let c = c0; c <= c1; c++) {
      for (let k = 0; k < 4; k++) {
        const hx = hash(c, r * 7 + k), hy = hash(r + k * 3, c * 5);
        C.rect(sx(c + hx), sy(r + 0.12 + hy * 0.76, L), sd, sd * 0.7);
      }
    }
    C.fill();
    C.fillStyle = shade(P.gravel, 0.22);
    C.beginPath();
    for (let c = c0; c <= c1; c++) {
      for (let k = 0; k < 3; k++) {
        const hx = hash(c * 3 + 1, r + k), hy = hash(r * 2 + k, c + 9);
        C.rect(sx(c + hx), sy(r + 0.12 + hy * 0.76, L), sd, sd * 0.7);
      }
    }
    C.fill();
    // sleepers
    const slTop = P.sleeper, slSide = shade(P.sleeper, -0.35);
    for (let c = c0; c <= c1; c++) {
      box(c + 0.33, c + 0.67, r + 0.16, r + 0.84, L, L + 0.05, slTop, slSide, 0);
    }
    // rails
    const xl = -10, xr = W + 10;
    boxS(xl, xr, sy(r + 0.72, L + 0.1), sy(r + 0.65, L + 0.1), sy(r + 0.65, L), P.railTop, P.rail, 0);
    boxS(xl, xr, sy(r + 0.36, L + 0.1), sy(r + 0.29, L + 0.1), sy(r + 0.29, L), P.railTop, P.rail, 0);
  }

  function drawBank(r, L, Lnear) {
    const P = HH.PAL;
    const y0 = sy(r, L), y1 = sy(r, Lnear);
    if (y1 - y0 < 0.5) return;
    C.fillStyle = P.dirt;
    C.fillRect(0, y0, W, y1 - y0 + 0.5);
    C.fillStyle = P.dirtDark;
    C.fillRect(0, y0 + (y1 - y0) * 0.62, W, (y1 - y0) * 0.38 + 0.5);
    C.fillStyle = 'rgba(255,255,255,0.18)';
    C.fillRect(0, y0, W, Math.max(1, TW * 0.02));
  }

  function drawLogs(lane, r, L, x0, x1, t) {
    const P = HH.PAL, logs = lane.logs;
    if (!logs) return;
    const top0 = HH.LOG_TOP != null ? HH.LOG_TOP : 0.06;
    for (let i = 0; i < logs.length; i++) {
      const g = logs[i];
      if (g.x + g.len < x0 || g.x > x1) continue;
      const bob = Math.sin(t * 2.3 + i * 1.7 + r) * 0.018;
      const zt = top0 + bob, zb = L - 0.02;
      const xl = sx(g.x + 0.04), xr = sx(g.x + g.len - 0.04);
      const yt = sy(r + 0.86, zt), ym = sy(r + 0.14, zt), yb = sy(r + 0.14, zb);
      // little foam at the waterline
      C.fillStyle = 'rgba(255,255,255,0.35)';
      C.beginPath();
      rrPath(xl - TW * 0.05, yb - TD * 0.08, xr - xl + TW * 0.1, TD * 0.14, TD * 0.07);
      C.fill();
      boxS(xl, xr, yt, ym, yb, P.logTop, P.logSide, TW * 0.14);
      // bark grooves on top
      C.fillStyle = shade(P.logTop, -0.18);
      const gh = Math.max(1, TD * 0.035);
      C.fillRect(xl + TW * 0.3, yt + (ym - yt) * 0.32, (xr - xl) * 0.45, gh);
      C.fillRect(xl + (xr - xl) * 0.4, yt + (ym - yt) * 0.66, (xr - xl) * 0.42 - TW * 0.3, gh);
      C.fillStyle = shade(P.logTop, 0.2);
      C.fillRect(xl + TW * 0.25, yt + (ym - yt) * 0.12, (xr - xl) - TW * 0.5, gh);
      // ring ends
      const ry = (yb - yt) * 0.48, rx = Math.min(TW * 0.16, (xr - xl) * 0.2), cy = (yt + yb) / 2;
      for (let e = 0; e < 2; e++) {
        const cx = e === 0 ? xl + rx : xr - rx;
        C.fillStyle = P.logRing;
        C.beginPath(); C.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); C.fill();
        C.strokeStyle = P.logRingDark;
        C.lineWidth = Math.max(1, TW * 0.022);
        C.beginPath(); C.ellipse(cx, cy, rx * 0.95, ry * 0.95, 0, 0, Math.PI * 2); C.stroke();
        C.beginPath(); C.ellipse(cx, cy, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2); C.stroke();
        C.beginPath(); C.ellipse(cx, cy, rx * 0.25, ry * 0.25, 0, 0, Math.PI * 2); C.stroke();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Objects
  // ---------------------------------------------------------------------------
  function drawTree(o, lane, r, L) {
    const P = HH.PAL, c = o.col;
    const v = hash(c + 0.37, r + (lane.seed || 0) * 13);
    const sf = 0.9 + v * 0.16;
    const leaf = P.leaf[(o.variant | 0) % P.leaf.length];
    box(c + 0.41, c + 0.59, r + 0.4, r + 0.56, L, L + 0.5, P.trunkTop, P.trunkSide, 0);
    const tiers = Math.max(1, Math.min(3, o.tiers | 0 || 1));
    const cx = c + 0.5, cr = r + 0.5;
    for (let i = 0; i < tiers; i++) {
      const hw = (0.42 - i * 0.1) * sf;
      const hd = hw * 0.74;
      const z0 = L + 0.44 + i * 0.4 * sf, z1 = z0 + 0.46 * sf;
      const top = i === tiers - 1 ? shade(leaf[0], 0.08) : leaf[0];
      box(cx - hw, cx + hw, cr - hd, cr + hd, z0, z1, top, leaf[1], TW * 0.06);
    }
  }

  function drawRock(o, lane, r, L) {
    const P = HH.PAL, c = o.col, v = (o.variant | 0) % 3;
    const w = 0.34 + v * 0.03, d = 0.27 + v * 0.02;
    box(c + 0.5 - w, c + 0.5 + w, r + 0.5 - d, r + 0.5 + d, L, L + 0.28 + v * 0.03, P.rockTop, P.rockSide, TW * 0.05);
    const ox = v === 1 ? -0.08 : 0.06;
    box(c + 0.5 + ox - 0.17, c + 0.5 + ox + 0.15, r + 0.45, r + 0.66, L + 0.28 + v * 0.03, L + 0.44 + v * 0.03,
      shade(P.rockTop, 0.12), P.rockSide, TW * 0.04);
  }

  function carColors(idx) {
    const cs = HH.PAL.cars;
    return cs[(((idx | 0) % cs.length) + cs.length) % cs.length];
  }

  function wheels(xs, r, z0) {
    C.fillStyle = WHEEL;
    const wh = 0.2;
    for (let i = 0; i < xs.length; i++) {
      const xl = sx(xs[i] - 0.12), yt = sy(r, z0 + wh);
      C.beginPath();
      rrPath(xl, yt, TW * 0.24, sy(r, z0) - yt, TW * 0.05);
      C.fill();
    }
  }

  const wx2 = [0, 0], wx3 = [0, 0, 0];
  function drawCar(v, lane, r, L) {
    const col = carColors(v.color);
    const top = col[0], side = col[1];
    const dir = lane.dir || 1, x = v.x, len = v.len || 1.3;
    const lead = dir > 0 ? x + len : x;
    box(x + 0.04, x + len - 0.04, r + 0.16, r + 0.84, L + 0.12, L + 0.42, top, side, TW * 0.13);
    // cabin
    const ccx = x + len * 0.5 - dir * len * 0.09, hw = len * 0.26;
    box(ccx - hw, ccx + hw, r + 0.25, r + 0.75, L + 0.42, L + 0.68, shade(top, 0.38), shade(top, 0.08), TW * 0.08);
    frontRect(ccx - hw + 0.05, ccx + hw - 0.05, r + 0.25, L + 0.47, L + 0.62, WINDOW, TW * 0.03);
    C.fillStyle = 'rgba(255,255,255,0.35)';
    C.fillRect(sx(ccx - hw + 0.09), sy(r + 0.25, L + 0.6), TW * 0.08, TD * 0.06);
    // windshield on cabin top at leading edge
    const wsx = dir > 0 ? ccx + hw - 0.12 : ccx - hw + 0.04;
    topRect(wsx, wsx + 0.08, r + 0.3, r + 0.7, L + 0.68, WINDOW);
    // headlights / taillights on front face
    const hx = dir > 0 ? lead - 0.16 : lead + 0.05;
    frontRect(hx, hx + 0.11, r + 0.16, L + 0.24, L + 0.33, HEAD, TW * 0.025);
    const tx = dir > 0 ? x + 0.07 : x + len - 0.16;
    frontRect(tx, tx + 0.09, r + 0.16, L + 0.24, L + 0.32, TAIL, TW * 0.02);
    // headlights on top at nose
    const htx = dir > 0 ? lead - 0.13 : lead + 0.05;
    topRect(htx, htx + 0.08, r + 0.66, r + 0.76, L + 0.42, HEAD);
    topRect(htx, htx + 0.08, r + 0.24, r + 0.34, L + 0.42, HEAD);
    wx2[0] = x + 0.32; wx2[1] = x + len - 0.32;
    wheels(wx2, r + 0.14, L);
  }

  function drawTruck(v, lane, r, L) {
    const P = HH.PAL, col = carColors(v.color);
    const top = col[0], side = col[1];
    const dir = lane.dir || 1, x = v.x, len = v.len || 2.2;
    const cabL = 0.78;
    let cx0, cx1, gx0, gx1;
    if (dir > 0) { cx0 = x + len - cabL; cx1 = x + len; gx0 = x + 0.04; gx1 = x + len - cabL - 0.06; }
    else { cx0 = x; cx1 = x + cabL; gx0 = x + cabL + 0.06; gx1 = x + len - 0.04; }
    // hitch
    box(Math.min(gx1, cx1) - 0.1, Math.max(gx0, cx0) + 0.1, r + 0.4, r + 0.6, L + 0.14, L + 0.24, '#555866', '#3a3c46', 0);
    // cargo
    box(gx0, gx1, r + 0.12, r + 0.88, L + 0.12, L + 0.88, P.truckCargo[0], P.truckCargo[1], TW * 0.05);
    frontRect(gx0 + 0.06, gx1 - 0.06, r + 0.12, L + 0.36, L + 0.46, top, 0);
    topRect(gx0 + 0.1, gx1 - 0.1, r + 0.47, r + 0.53, L + 0.88, shade(P.truckCargo[1], 0.2));
    // cab
    box(cx0 + 0.04, cx1 - 0.04, r + 0.15, r + 0.85, L + 0.12, L + 0.66, top, side, TW * 0.1);
    const wsx = dir > 0 ? cx1 - 0.24 : cx0 + 0.1;
    topRect(wsx, wsx + 0.14, r + 0.24, r + 0.76, L + 0.66, WINDOW);
    const swx = dir > 0 ? cx0 + 0.18 : cx0 + 0.12;
    frontRect(swx, swx + 0.46, r + 0.15, L + 0.42, L + 0.6, WINDOW, TW * 0.03);
    const lead = dir > 0 ? x + len : x;
    const hx = dir > 0 ? lead - 0.17 : lead + 0.06;
    frontRect(hx, hx + 0.11, r + 0.15, L + 0.2, L + 0.3, HEAD, TW * 0.025);
    const tx = dir > 0 ? x + 0.08 : x + len - 0.17;
    frontRect(tx, tx + 0.09, r + 0.12, L + 0.18, L + 0.28, TAIL, TW * 0.02);
    wx3[0] = x + 0.32; wx3[1] = x + len * 0.5 - dir * 0.2; wx3[2] = x + len - 0.32;
    wheels(wx3, r + 0.1, L);
  }

  function drawTrain(lane, r, L, x0, x1, t) {
    const P = HH.PAL, tr = lane.train;
    const cars = Math.max(1, tr.cars | 0 || 1);
    const carLen = (tr.len || cars * 3) / cars;
    const dir = tr.dir || 1;
    const loco = dir > 0 ? cars - 1 : 0;
    const winC = '#3a2d40', under = '#2b2a31';
    for (let i = 0; i < cars; i++) {
      const a = tr.x + i * carLen, b = a + carLen;
      if (b < x0 - 1 || a > x1 + 1) continue;
      // coupling to next car
      if (i < cars - 1) box(b - 0.18, b + 0.18, r + 0.4, r + 0.6, L + 0.22, L + 0.42, '#4a3a3a', '#2e2426', 0);
      // undercarriage / wheels
      frontRect(a + 0.2, b - 0.2, r + 0.16, L, L + 0.18, under, TW * 0.04);
      const isLoco = i === loco;
      box(a + 0.08, b - 0.08, r + 0.1, r + 0.9, L + 0.14, L + 0.92, P.trainTop, P.trainSide, TW * (isLoco ? 0.16 : 0.08));
      // stripe
      frontRect(a + 0.12, b - 0.12, r + 0.1, L + 0.36, L + 0.45, P.trainStripe, 0);
      // roof detail
      topRect(a + 0.3, b - 0.3, r + 0.44, r + 0.56, L + 0.92, shade(P.trainTop, -0.12));
      if (isLoco) {
        const nose = dir > 0 ? b - 0.08 : a + 0.08;
        // windshield on top at nose
        const wsx = dir > 0 ? nose - 0.42 : nose + 0.16;
        topRect(wsx, wsx + 0.26, r + 0.2, r + 0.8, L + 0.92, winC);
        // cab window on front face
        const cwx = dir > 0 ? nose - 0.9 : nose + 0.3;
        frontRect(cwx, cwx + 0.6, r + 0.1, L + 0.54, L + 0.8, winC, TW * 0.04);
        C.fillStyle = 'rgba(255,255,255,0.3)';
        C.fillRect(sx(cwx + 0.06), sy(r + 0.1, L + 0.76), TW * 0.12, TD * 0.07);
        // headlight
        const hx = dir > 0 ? nose - 0.16 : nose + 0.16;
        const hy = sy(r + 0.1, L + 0.27);
        glow('head', '255,240,180', sx(hx), hy, TW * 0.55, 0.75);
        C.fillStyle = HEAD;
        C.beginPath(); C.arc(sx(hx), hy, TW * 0.07, 0, Math.PI * 2); C.fill();
        // rest windows behind cab
        const ra = dir > 0 ? a + 0.3 : cwx + 0.8, rb = dir > 0 ? cwx - 0.2 : b - 0.3;
        for (let wx = ra; wx + 0.36 <= rb; wx += 0.58) frontRect(wx, wx + 0.36, r + 0.1, L + 0.56, L + 0.78, winC, TW * 0.03);
      } else {
        const n = Math.max(1, Math.floor((carLen - 0.4) / 0.58));
        const start = a + (carLen - (n * 0.58 - 0.22)) / 2;
        for (let k = 0; k < n; k++) {
          const wx = start + k * 0.58;
          frontRect(wx, wx + 0.36, r + 0.1, L + 0.56, L + 0.78, winC, TW * 0.03);
        }
      }
    }
  }

  function drawCrossing(px, lane, r, L, t) {
    const P = HH.PAL;
    const rn = r + 0.02, rf = r + 0.1;
    box(px - 0.05, px + 0.05, rn + 0.02, rf, L, L + 1.0, '#eeeae2', '#b8b0a2', 0);
    // crossbuck X
    const cxs = sx(px), cys = sy(rn + 0.02, L + 0.72), arm = TW * 0.16;
    C.lineCap = 'round';
    C.strokeStyle = '#d6434a'; C.lineWidth = Math.max(2, TW * 0.075);
    C.beginPath();
    C.moveTo(cxs - arm, cys - arm * 0.55); C.lineTo(cxs + arm, cys + arm * 0.55);
    C.moveTo(cxs + arm, cys - arm * 0.55); C.lineTo(cxs - arm, cys + arm * 0.55);
    C.stroke();
    C.strokeStyle = '#ffffff'; C.lineWidth = Math.max(1, TW * 0.035);
    C.stroke();
    // lamp housing
    box(px - 0.17, px + 0.17, rn, rf + 0.06, L + 1.0, L + 1.3, '#4a4d5a', '#2b2d36', TW * 0.04);
    const lx = sx(px), ly = sy(rn, L + 1.15), lr = TW * 0.085;
    if (lane.light) {
      glow('amber', '255,181,46', lx, ly, TW * 0.7, 0.9);
      glow('amber', '255,181,46', lx, sy(r - 0.1, L), TW * 0.6, 0.35);
      C.fillStyle = P.amber;
      C.beginPath(); C.arc(lx, ly, lr, 0, Math.PI * 2); C.fill();
      C.fillStyle = '#fff3c8';
      C.beginPath(); C.arc(lx - lr * 0.3, ly - lr * 0.3, lr * 0.4, 0, Math.PI * 2); C.fill();
    } else {
      C.fillStyle = '#6e5634';
      C.beginPath(); C.arc(lx, ly, lr, 0, Math.PI * 2); C.fill();
    }
  }

  function drawCoin(cn, r, L, t) {
    const P = HH.PAL;
    const ph = cn.phase || 0;
    const cx = sx(cn.col + 0.5), cy = sy(r + 0.5, L + 0.38 + Math.sin(t * 3 + ph) * 0.06);
    const R0 = TW * 0.19;
    const w = Math.abs(Math.cos(t * 4 + ph));
    const rx = Math.max(R0 * w, 0.5);
    const th = R0 * 0.16;
    C.fillStyle = P.coinSide;
    C.beginPath(); C.ellipse(cx, cy + th * 0.4, rx + th * (1 - w * 0.5), R0, 0, 0, Math.PI * 2); C.fill();
    C.fillStyle = P.coinTop;
    C.beginPath(); C.ellipse(cx, cy, rx, R0, 0, 0, Math.PI * 2); C.fill();
    if (w > 0.25) {
      C.strokeStyle = P.coinSide;
      C.lineWidth = Math.max(1, R0 * 0.14);
      C.beginPath(); C.ellipse(cx, cy, rx * 0.6, R0 * 0.6, 0, 0, Math.PI * 2); C.stroke();
      C.fillStyle = 'rgba(255,255,255,0.6)';
      C.beginPath(); C.ellipse(cx - rx * 0.35, cy - R0 * 0.4, rx * 0.18, R0 * 0.22, 0, 0, Math.PI * 2); C.fill();
    }
    const sp = (t * 1.1 + ph * 3.7) % 1.8;
    if (sp < 0.35) {
      const k = Math.sin((sp / 0.35) * Math.PI);
      C.fillStyle = '#ffffff';
      star(cx + R0 * 0.45, cy - R0 * 0.55, R0 * 0.55 * k);
    }
  }

  // ---------------------------------------------------------------------------
  // Robot "Blip" (drawn in local coords under a transform anchored at feet)
  // ---------------------------------------------------------------------------
  const ROBOT_SCALE = 1.28;
  function LX(x) { return x * TW; }
  function LY(r, z) { return -r * TD - z * HS; }
  function lbox(x0, x1, r0, r1, z0, z1, top, side, rad) {
    boxS(LX(x0), LX(x1), LY(r1, z1), LY(r0, z1), LY(r0, z0), top, side, rad || 0);
  }

  function robotBody(p, t) {
    const P = HH.PAL;
    const hopping = p.hopT != null && p.hopT >= 0;
    const lift = hopping ? Math.sin(p.hopT * Math.PI) * 0.07 : 0;
    const legT = hopping ? Math.sin(p.hopT * Math.PI) * 0.03 : 0;
    const dark = P.robotDark, darker = shade(P.robotDark, -0.3);
    // legs
    lbox(-0.16, -0.06, -0.07, 0.07, legT, 0.15, dark, darker, TW * 0.02);
    lbox(0.06, 0.16, -0.07, 0.07, legT, 0.15, dark, darker, TW * 0.02);
    // arms
    lbox(-0.335, -0.24, -0.06, 0.06, 0.2 + lift, 0.4 + lift, P.robotMid, dark, TW * 0.025);
    lbox(0.24, 0.335, -0.06, 0.06, 0.2 + lift, 0.4 + lift, P.robotMid, dark, TW * 0.025);
    // body
    lbox(-0.25, 0.25, -0.19, 0.19, 0.12, 0.48, P.robotTop, P.robotSide, TW * 0.06);
    // chest panel
    C.fillStyle = P.robotMid;
    C.beginPath(); rrPath(LX(-0.13), LY(-0.19, 0.38), LX(0.26), LY(0, 0.2) - LY(0, 0.38), TW * 0.03); C.fill();
    const dots = ['#ff6b81', '#ffd84d', '#5ff6ff'];
    for (let i = 0; i < 3; i++) {
      C.fillStyle = (Math.floor(t * 3) % 3) === i ? dots[i] : shade(dots[i], -0.45);
      C.beginPath(); C.arc(LX(-0.07 + i * 0.07), LY(-0.19, 0.29), TW * 0.022, 0, Math.PI * 2); C.fill();
    }
    // neck
    lbox(-0.07, 0.07, -0.06, 0.06, 0.47, 0.53, dark, darker, 0);
    // head
    lbox(-0.21, 0.21, -0.17, 0.17, 0.52, 0.84, P.robotTop, P.robotSide, TW * 0.07);
    // ear bolts
    lbox(-0.255, -0.21, -0.05, 0.05, 0.62, 0.73, P.robotMid, dark, TW * 0.015);
    lbox(0.21, 0.255, -0.05, 0.05, 0.62, 0.73, P.robotMid, dark, TW * 0.015);
    // visor
    const vx = LX(-0.17), vy = LY(-0.17, 0.79), vw = LX(0.34), vh = LY(0, 0.56) - LY(0, 0.79);
    C.fillStyle = dark;
    C.beginPath(); rrPath(vx, vy, vw, vh, TW * 0.05); C.fill();
    C.fillStyle = 'rgba(255,255,255,0.12)';
    C.fillRect(vx + TW * 0.04, vy + vh * 0.12, vw - TW * 0.08, Math.max(1, vh * 0.1));
    // eye
    let ex = 0, ez = 0.675;
    const f = p.facing;
    if (f === 'left') ex = -0.075;
    else if (f === 'right') ex = 0.075;
    else if (f === 'up') ez = 0.71;
    const blink = p.blink == null ? 1 : Math.max(0.1, Math.min(1, p.blink));
    const er = TW * 0.066;
    C.shadowColor = P.eyeGlow;
    C.shadowBlur = TW * 0.3;
    C.fillStyle = P.eye;
    C.beginPath(); C.ellipse(LX(ex), LY(-0.17, ez), er, er * blink, 0, 0, Math.PI * 2); C.fill();
    C.shadowBlur = 0;
    C.shadowColor = 'rgba(0,0,0,0)';
    if (blink > 0.4) {
      C.fillStyle = '#ffffff';
      C.beginPath(); C.arc(LX(ex) - er * 0.3, LY(-0.17, ez) - er * 0.3 * blink, er * 0.3, 0, Math.PI * 2); C.fill();
    }
    // antenna
    const a = p.antenna || 0, alen = 0.24;
    const bx = LX(0), by = LY(0, 0.84);
    const tx = LX(Math.sin(a) * alen), ty = LY(0, 0.84 + Math.cos(a) * alen);
    C.strokeStyle = dark;
    C.lineWidth = Math.max(1.5, TW * 0.028);
    C.lineCap = 'round';
    C.beginPath(); C.moveTo(bx, by); C.quadraticCurveTo(bx, (by + ty) / 2, tx, ty); C.stroke();
    lbox(-0.05, 0.05, -0.04, 0.04, 0.84, 0.87, P.robotMid, dark, 0);
    glow('amber', '255,181,46', tx, ty, TW * 0.16, 0.75);
    C.fillStyle = '#ffcf5a';
    C.beginPath(); C.arc(tx, ty, TW * 0.045, 0, Math.PI * 2); C.fill();
    C.fillStyle = '#fff6d8';
    C.beginPath(); C.arc(tx - TW * 0.014, ty - TW * 0.014, TW * 0.016, 0, Math.PI * 2); C.fill();
  }

  function drawRobot(p, t) {
    const sink = p.sink || 0;
    const zb = (p.groundZ || 0) + (p.z || 0) - sink * 0.6;
    const ax = sx((p.x || 0) + 0.5), ay = sy((p.y || 0) + 0.5, zb);
    const sq = p.squash || 0;
    let scY = 1 + sq, scX = 1 - sq * 0.6;
    if (p.hopT == null || p.hopT < 0) {
      const br = Math.sin(t * 3.2) * 0.022;
      scY += br; scX -= br * 0.5;
    }
    C.save();
    if (sink > 0) C.globalAlpha = Math.max(0, 1 - sink);
    C.translate(ax, ay);
    C.scale(scX * ROBOT_SCALE, scY * ROBOT_SCALE);
    robotBody(p, t);
    C.restore();
  }

  function drawRobotDangling(p, e, t) {
    C.save();
    C.translate(sx(e.x), sy(e.row, e.z || 0));
    C.rotate(Math.sin(t * 7) * 0.18);
    C.translate(0, 0.95 * HS);
    C.scale(ROBOT_SCALE, ROBOT_SCALE);
    robotBody(p, t);
    C.restore();
  }

  // ---------------------------------------------------------------------------
  // Eagle
  // ---------------------------------------------------------------------------
  function wing(xin, xout, r0, r1, zi, zo, top, side) {
    const th = 0.07;
    const a1x = sx(xin), a2x = sx(xout);
    C.fillStyle = side;
    C.beginPath();
    C.moveTo(a1x, sy(r0, zi)); C.lineTo(a2x, sy(r0, zo));
    C.lineTo(a2x, sy(r0, zo - th)); C.lineTo(a1x, sy(r0, zi - th));
    C.closePath(); C.fill();
    C.fillStyle = top;
    C.beginPath();
    C.moveTo(a1x, sy(r1, zi)); C.lineTo(a2x, sy(r1, zo));
    C.lineTo(a2x, sy(r0, zo)); C.lineTo(a1x, sy(r0, zi));
    C.closePath(); C.fill();
    // feather tips
    const xm = xin + (xout - xin) * 0.72, zm = zi + (zo - zi) * 0.72;
    C.fillStyle = side;
    C.beginPath();
    C.moveTo(sx(xm), sy(r1, zm)); C.lineTo(a2x, sy(r1, zo));
    C.lineTo(a2x, sy(r0, zo)); C.lineTo(sx(xm), sy(r0, zm));
    C.closePath(); C.globalAlpha = 0.45; C.fill(); C.globalAlpha = 1;
  }

  function drawEagle(e, p, t) {
    const P = HH.PAL;
    const ex = e.x, er = e.row, ez = e.z || 0;
    if (e.carrying && p) drawRobotDangling(p, e, t);
    const top = P.eagleTop, side = P.eagleSide;
    // tail
    box(ex - 0.2, ex + 0.2, er + 0.38, er + 0.78, ez + 0.2, ez + 0.3, side, shade(side, -0.25), TW * 0.03);
    // wings
    const fl = Math.sin(e.flap || 0) * 0.55;
    const zi = ez + 0.34, zo = zi + fl;
    wing(ex - 0.28, ex - 1.35, er - 0.18, er + 0.32, zi, zo, top, side);
    wing(ex + 0.28, ex + 1.35, er - 0.18, er + 0.32, zi, zo, top, side);
    // body
    box(ex - 0.3, ex + 0.3, er - 0.28, er + 0.42, ez, ez + 0.44, top, side, TW * 0.08);
    frontRect(ex - 0.16, ex + 0.16, er - 0.28, ez + 0.06, ez + 0.3, shade(top, 0.3), TW * 0.05);
    // talons
    box(ex - 0.17, ex - 0.07, er - 0.32, er - 0.18, ez - 0.12, ez + 0.02, P.beak, shade(P.beak, -0.25), 0);
    box(ex + 0.07, ex + 0.17, er - 0.32, er - 0.18, ez - 0.12, ez + 0.02, P.beak, shade(P.beak, -0.25), 0);
    // head
    box(ex - 0.21, ex + 0.21, er - 0.55, er - 0.2, ez + 0.2, ez + 0.58, shade(top, 0.12), side, TW * 0.07);
    // beak
    box(ex - 0.08, ex + 0.08, er - 0.68, er - 0.55, ez + 0.26, ez + 0.38, P.beak, shade(P.beak, -0.25), TW * 0.02);
    box(ex - 0.045, ex + 0.045, er - 0.71, er - 0.66, ez + 0.19, ez + 0.27, shade(P.beak, -0.1), shade(P.beak, -0.35), 0);
    // eyes
    const ey = sy(er - 0.55, ez + 0.47), eR = TW * 0.062;
    for (let s = -1; s <= 1; s += 2) {
      const exs = sx(ex + s * 0.11);
      C.fillStyle = '#ffffff';
      C.beginPath(); C.arc(exs, ey, eR, 0, Math.PI * 2); C.fill();
      C.fillStyle = '#1e1a28';
      C.beginPath(); C.arc(exs - s * eR * 0.2, ey + eR * 0.3, eR * 0.5, 0, Math.PI * 2); C.fill();
      // brow
      C.strokeStyle = shade(side, -0.4);
      C.lineWidth = Math.max(1.5, TW * 0.03);
      C.lineCap = 'round';
      C.beginPath();
      C.moveTo(exs - s * eR * 1.1, ey - eR * 1.35); C.lineTo(exs + s * eR * 0.9, ey - eR * 0.8);
      C.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Main draw
  // ---------------------------------------------------------------------------
  const items = []; // reusable sort list
  let itemCount = 0;
  const pool = [];
  function push(k, type, a, lane, r) {
    let it = pool[itemCount];
    if (!it) { it = { k: 0, type: 0, a: null, lane: null, r: 0 }; pool[itemCount] = it; }
    it.k = k; it.type = type; it.a = a; it.lane = lane; it.r = r;
    items[itemCount++] = it;
  }
  function byKey(a, b) { return b.k - a.k; }

  const T_TREE = 1, T_ROCK = 2, T_CAR = 3, T_TRUCK = 4, T_TRAIN = 5, T_XING_L = 6, T_XING_R = 7,
    T_COIN = 8, T_ROBOT = 9, T_EAGLE = 10;

  function draw(ctx, game) {
    C = ctx;
    if (!W || !H) {
      const cv = ctx.canvas;
      resize((cv && (cv.clientWidth || cv.width)) || 800, (cv && (cv.clientHeight || cv.height)) || 600);
    }
    game = game || HH.game;
    shX = 0; shY = 0;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (!game || !game.lanes || !HH.PAL) { C = null; return; }
    syncCam();
    const shk = (game.cam && game.cam.shake) || 0;
    if (shk > 0) { shX = (Math.random() * 2 - 1) * shk; shY = (Math.random() * 2 - 1) * shk; }

    const P = HH.PAL, lanes = game.lanes, t = game.time || 0;
    const COLS = HH.COLS || 9;
    const v = visibleRange();
    const x0 = v.minX, x1 = v.maxX;
    const c0 = Math.floor(x0), c1 = Math.ceil(x1);

    // (1)+(2) ground far -> near, logs right after their lane
    for (let r = v.maxRow; r >= v.minRow; r--) {
      const lane = lanes.get(r);
      if (!lane) continue;
      const L = level(lane);
      const near = lanes.get(r - 1), far = lanes.get(r + 1);
      switch (lane.type) {
        case 'grass': drawGrass(lane, r, L, near, x0, x1, c0, c1, t); break;
        case 'road': drawRoad(lane, r, L, near, far, c0, c1); break;
        case 'river': drawRiver(lane, r, L, far, x0, x1, t); break;
        case 'rail': drawRail(lane, r, L, c0, c1); break;
        default: C.fillStyle = P.grassA; C.fillRect(0, sy(r + 1, L), W, sy(r, L) - sy(r + 1, L) + 1);
      }
      if (near) {
        const Ln = level(near);
        if (Ln < L) drawBank(r, L, Ln);
      }
      if (lane.type === 'river') drawLogs(lane, r, L, x0, x1, t);
    }

    // out-of-bounds darkening
    const ex0 = sx(0), ex1 = sx(COLS);
    C.fillStyle = OOB;
    if (ex0 > 0) C.fillRect(0, 0, ex0, H);
    if (ex1 < W) C.fillRect(ex1, 0, W - ex1, H);
    C.fillStyle = OOB_EDGE;
    const eW = Math.max(2, TW * 0.06);
    if (ex0 > 0) C.fillRect(ex0 - eW, 0, eW, H);
    if (ex1 < W) C.fillRect(ex1, 0, eW, H);

    // (3) shadows + collect objects
    itemCount = 0;
    for (let r = v.maxRow; r >= v.minRow; r--) {
      const lane = lanes.get(r);
      if (!lane) continue;
      const L = level(lane);
      if (lane.type === 'grass' && lane.obstacles) {
        const ob = lane.obstacles;
        for (let i = 0; i < ob.length; i++) {
          const o = ob[i];
          if (o.col + 1 < x0 || o.col > x1) continue;
          if (o.kind === 'rock') {
            shadow(o.col + 0.52, r + 0.44, L, 0.95, 0.72, 0.8);
            push(r, T_ROCK, o, lane, r);
          } else {
            shadow(o.col + 0.53, r + 0.44, L, 1.0, 0.8, 0.9);
            push(r, T_TREE, o, lane, r);
          }
        }
      } else if (lane.type === 'road' && lane.vehicles) {
        const vs = lane.vehicles;
        for (let i = 0; i < vs.length; i++) {
          const vh = vs[i], len = vh.len || 1.3;
          if (vh.x + len < x0 || vh.x > x1) continue;
          shadow(vh.x + len / 2, r + 0.45, L, len + 0.35, 0.95, 0.85);
          push(r, vh.kind === 'truck' ? T_TRUCK : T_CAR, vh, lane, r);
        }
      } else if (lane.type === 'rail') {
        const tr = lane.train;
        if (tr && tr.state === 'pass') {
          const cars = Math.max(1, tr.cars | 0 || 1), cl = (tr.len || cars * 3) / cars;
          for (let i = 0; i < cars; i++) {
            const a = tr.x + i * cl;
            if (a + cl < x0 || a > x1) continue;
            shadow(a + cl / 2, r + 0.45, L, cl + 0.3, 1.0, 0.85);
          }
          push(r, T_TRAIN, tr, lane, r);
        }
        if (-0.6 >= x0 - 1) { shadow(-0.6, r + 0.06, L, 0.5, 0.3, 0.6); push(r - 0.005, T_XING_L, null, lane, r); }
        if (COLS + 0.6 <= x1 + 1) { shadow(COLS + 0.6, r + 0.06, L, 0.5, 0.3, 0.6); push(r - 0.005, T_XING_R, null, lane, r); }
      }
      const cs = lane.coins;
      if (cs) {
        for (let i = 0; i < cs.length; i++) {
          const cn = cs[i];
          if (cn.taken || cn.col + 1 < x0 || cn.col > x1) continue;
          const bob = Math.sin(t * 3 + (cn.phase || 0));
          shadow(cn.col + 0.5, r + 0.42, L, 0.38 - bob * 0.04, 0.26, 0.55);
          push(r, T_COIN, cn, lane, r);
        }
      }
    }

    const p = game.player, e = game.eagle;
    if (p && p.visible !== false) {
      const sink = p.sink || 0;
      const k = 1 / (1 + Math.max(0, p.z || 0) * 1.4);
      shadow((p.x || 0) + 0.5, (p.y || 0) + 0.44, p.groundZ || 0, 0.8 * k, 0.6 * k, 0.75 * (0.6 + 0.4 * k) * (1 - sink));
      push((p.y || 0) - 0.01, T_ROBOT, p, null, 0);
    }
    if (e) {
      const gl = level(lanes.get(Math.floor(e.row)));
      const near = 1 - Math.max(0, Math.min(1, (e.z || 0) / 5));
      const k = 0.65 + 0.55 * near;
      shadow(e.x, e.row, gl, 2.9 * k, 1.3 * k, 0.45 + 0.4 * near);
      push(-1e9, T_EAGLE, e, null, 0);
    }

    // (4) depth-sorted objects
    items.length = itemCount;
    items.sort(byKey);
    for (let i = 0; i < itemCount; i++) {
      const it = items[i], lane = it.lane, r = it.r;
      const L = lane ? level(lane) : 0;
      switch (it.type) {
        case T_TREE: drawTree(it.a, lane, r, L); break;
        case T_ROCK: drawRock(it.a, lane, r, L); break;
        case T_CAR: drawCar(it.a, lane, r, L); break;
        case T_TRUCK: drawTruck(it.a, lane, r, L); break;
        case T_TRAIN: drawTrain(lane, r, L, x0, x1, t); break;
        case T_XING_L: drawCrossing(-0.6, lane, r, L, t); break;
        case T_XING_R: drawCrossing(COLS + 0.6, lane, r, L, t); break;
        case T_COIN: drawCoin(it.a, r, L, t); break;
        case T_ROBOT: drawRobot(it.a, t); break;
        case T_EAGLE: drawEagle(it.a, p, t); break;
      }
      it.a = null; it.lane = null;
    }

    // (5) particles
    if (HH.fx && typeof HH.fx.draw === 'function') {
      try { HH.fx.draw(ctx); } catch (err) { /* keep rendering */ }
    }
    if (vignette) ctx.drawImage(vignette, 0, 0, W, H);
    C = null;
  }

  R.resize = resize;
  R.sx = sx;
  R.sy = sy;
  R.visibleRange = visibleRange;
  R.draw = draw;
  R.TW = TW; R.TD = TD; R.HS = HS; R.W = W; R.H = H;

  if (typeof window !== 'undefined' && window.innerWidth) {
    try { resize(window.innerWidth, window.innerHeight); } catch (err) { /* ignore */ }
  }
})();
