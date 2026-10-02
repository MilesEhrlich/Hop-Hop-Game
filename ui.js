// HOP-HOP HUD + screens: big rounded text sitting directly on the scene, no panels.
(function () {
  'use strict';
  const HH = (window.HH = window.HH || {});

  const FONT = '"Fredoka", "Nunito", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
  const SHADOW = 'rgba(30,40,60,0.35)';
  const GOLD = '#ffd94a';
  const CANDY = ['#ff7aa8', '#ffd84d', '#5cc8ff', '#ffffff', '#ff9b4d', '#b48bff', '#4de0b0'];
  const HEADLINES = { car: 'BONK!', train: 'CHOO-CHOMP!', water: 'SPLOOSH!', eagle: 'SNATCHED!' };

  const muteRect = { x: -100, y: -100, w: 0, h: 0 };
  let lastScore = 0;
  let popStart = -10;
  let lastState = null;
  let coinsAtStart = 0;
  let vignette = null, vigW = 0, vigH = 0;

  function now() { return performance.now() / 1000; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutBack(t) {
    const c = 1.70158;
    t = clamp01(t) - 1;
    return 1 + (c + 1) * t * t * t + c * t * t;
  }
  function pulse(t, speed) { return 0.5 + 0.5 * Math.sin(t * speed); }

  // Text with soft drop shadow. align: 'left' | 'center' | 'right'.
  function text(ctx, str, x, y, size, color, align, alpha) {
    size = Math.max(10, Math.round(size));
    ctx.font = '700 ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'center';
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = size * 0.14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = size * 0.07;
    ctx.fillStyle = color || '#ffffff';
    ctx.fillText(str, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function dim(ctx, W, H, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#1a2438';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // ---------- icons ----------

  function coinIcon(ctx, cx, cy, r) {
    ctx.save();
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = r * 0.4;
    ctx.shadowOffsetY = r * 0.2;
    ctx.fillStyle = '#e0a91c';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.08, r * 0.86, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e0a91c';
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.08, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.32, cy - r * 0.42, r * 0.18, r * 0.11, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function muteIcon(ctx, x, y, s, muted) {
    // s = icon box size; drawn white with soft shadow
    ctx.save();
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = s * 0.12;
    ctx.shadowOffsetY = s * 0.06;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const u = s / 10;
    ctx.beginPath();
    ctx.moveTo(x + 1.2 * u, y + 3.7 * u);
    ctx.lineTo(x + 3.0 * u, y + 3.7 * u);
    ctx.lineTo(x + 5.4 * u, y + 1.6 * u);
    ctx.lineTo(x + 5.4 * u, y + 8.4 * u);
    ctx.lineTo(x + 3.0 * u, y + 6.3 * u);
    ctx.lineTo(x + 1.2 * u, y + 6.3 * u);
    ctx.closePath();
    ctx.lineWidth = u * 0.8;
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = u * 0.9;
    if (muted) {
      ctx.beginPath();
      ctx.moveTo(x + 6.7 * u, y + 3.6 * u); ctx.lineTo(x + 9.3 * u, y + 6.4 * u);
      ctx.moveTo(x + 9.3 * u, y + 3.6 * u); ctx.lineTo(x + 6.7 * u, y + 6.4 * u);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x + 5.6 * u, y + 5 * u, 1.9 * u, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 5.6 * u, y + 5 * u, 3.6 * u, -0.9, 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- pieces ----------

  function drawHud(ctx, game, W, H, m, pad, t) {
    // score with pop
    const score = game.score | 0;
    if (score > lastScore) popStart = t;
    lastScore = score;
    const pt = clamp01((t - popStart) / 0.25);
    const scale = 1 + 0.28 * Math.sin(pt * Math.PI) * (1 - pt * 0.3);
    const sSize = m * 0.13;
    ctx.save();
    ctx.translate(pad, pad + sSize * 0.42);
    ctx.scale(scale, scale);
    ctx.textBaseline = 'middle';
    text(ctx, String(score), 0, 0, sSize, '#ffffff', 'left');
    ctx.restore();
    ctx.textBaseline = 'top';
    text(ctx, 'BEST ' + (game.best | 0), pad + sSize * 0.04, pad + sSize * 0.92, Math.max(14, m * 0.04), '#ffffff', 'left', 0.9);

    // coins top-right
    const cSize = m * 0.065;
    const r = cSize * 0.38;
    const cy = pad + cSize * 0.5;
    ctx.textBaseline = 'middle';
    coinIcon(ctx, W - pad - r, cy, r);
    text(ctx, String(game.coins | 0), W - pad - r * 2 - cSize * 0.22, cy + cSize * 0.04, cSize, '#ffffff', 'right');
  }

  function drawMute(ctx, game, W, m, pad) {
    const s = Math.max(40, m * 0.06);
    muteRect.w = s; muteRect.h = s;
    muteRect.x = W - pad - s + s * 0.1;
    muteRect.y = pad + m * 0.065 + m * 0.02;
    const muted = game.muted != null ? game.muted : (HH.audio && HH.audio.muted);
    const icon = s * 0.8;
    muteIcon(ctx, muteRect.x + (s - icon) / 2, muteRect.y + (s - icon) / 2, icon, !!muted);
  }

  function drawDanger(ctx, game, W, H, t) {
    const d = clamp01(game.danger || 0);
    if (d <= 0) return;
    if (!vignette || vigW !== W || vigH !== H) {
      vigW = W; vigH = H;
      vignette = ctx.createLinearGradient(0, H, 0, H * 0.62);
      vignette.addColorStop(0, 'rgba(255,80,60,0.75)');
      vignette.addColorStop(0.45, 'rgba(255,150,60,0.28)');
      vignette.addColorStop(1, 'rgba(255,170,60,0)');
    }
    ctx.globalAlpha = d * (0.45 + 0.55 * pulse(t, 5 + d * 7));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
    ctx.globalAlpha = 1;
  }

  function drawTitle(ctx, game, W, H, m, t) {
    const word = 'HOP-HOP';
    let size = m * 0.19;
    ctx.font = '700 ' + Math.round(size) + 'px ' + FONT;
    const gap = size * 0.02;
    let total = 0;
    const widths = [];
    for (const ch of word) { const w = ctx.measureText(ch).width; widths.push(w); total += w + gap; }
    total -= gap;
    const fit = Math.min(1, (W * 0.9) / total);
    size *= fit; total *= fit;
    const px = Math.round(size);
    const baseY = H * 0.2;
    let x = W / 2 - total / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = '700 ' + px + 'px ' + FONT;
    for (let i = 0; i < word.length; i++) {
      const w = widths[i] * fit;
      const cx = x + w / 2;
      const bob = Math.sin(t * 3.2 - i * 0.6);
      const cy = baseY - Math.max(0, bob) * size * 0.12 + Math.min(0, bob) * -size * 0.02;
      const rot = Math.sin(t * 2.4 - i * 0.8) * 0.06;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.shadowColor = 'rgba(30,40,60,0.4)';
      ctx.shadowBlur = size * 0.1;
      ctx.shadowOffsetY = size * 0.08;
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(word[i], 0, 0);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = word[i] === '-' ? '#7d9cc4' : CANDY[i % CANDY.length] === '#ffffff' ? '#5cc8ff' : CANDY[i % CANDY.length];
      ctx.fillText(word[i], 0, 0);
      ctx.restore();
      x += w + gap * fit;
    }

    const sub = Math.max(15, Math.min(m * 0.05, W * 0.055));
    text(ctx, 'help Blip hop as far as it can!', W / 2, baseY + size * 0.72, sub, '#ffffff', 'center');

    const pSize = Math.max(18, Math.min(m * 0.065, W * 0.07));
    const prompt = game.isTouch ? 'tap to start' : 'press SPACE to start';
    const pp = pulse(t, 4.5);
    ctx.save();
    ctx.translate(W / 2, H * 0.84);
    ctx.scale(1 + pp * 0.05, 1 + pp * 0.05);
    text(ctx, prompt, 0, 0, pSize, '#ffffff', 'center', 0.65 + 0.35 * pp);
    ctx.restore();

    const cSize = Math.max(12, Math.min(m * 0.032, W * 0.036));
    const controls = game.isTouch ? 'tap to hop  ·  swipe to turn'
      : 'arrows / WASD to hop  ·  P pause  ·  M mute';
    text(ctx, controls, W / 2, H * 0.92, cSize, '#ffffff', 'center', 0.85);
  }

  function drawPaused(ctx, game, W, H, m, t) {
    dim(ctx, W, H, 0.35);
    ctx.textBaseline = 'middle';
    const big = Math.min(m * 0.15, W * 0.16);
    text(ctx, 'PAUSED', W / 2, H * 0.4, big, '#ffffff', 'center');
    const s = Math.max(15, Math.min(m * 0.045, W * 0.05));
    const msg = game.isTouch ? 'tap to resume' : 'press P or SPACE to resume';
    text(ctx, msg, W / 2, H * 0.4 + big * 0.85, s, '#ffffff', 'center', 0.7 + 0.3 * pulse(t, 4));
  }

  function drawOver(ctx, game, W, H, m, t) {
    const ot = game.overT || 0;
    const a = clamp01(ot / 0.35);
    dim(ctx, W, H, 0.28 * a);
    ctx.textBaseline = 'middle';

    // headline drops in with a bounce
    const head = HEADLINES[game.deathCause] || 'OOPS!';
    const hSize = Math.min(m * 0.15, (W * 0.9) / (head.length * 0.62));
    const hk = easeOutBack(ot / 0.45);
    ctx.save();
    ctx.translate(W / 2, H * 0.22 - (1 - clamp01(ot / 0.45)) * H * 0.1);
    ctx.rotate(Math.sin(t * 2.2) * 0.03);
    ctx.scale(Math.max(0.01, hk), Math.max(0.01, hk));
    text(ctx, head, 0, 0, hSize, '#ffffff', 'center', a);
    ctx.restore();

    // stats slide up one after another
    const line = (i, str, size, color, alpha) => {
      const k = clamp01((ot - 0.15 - i * 0.08) / 0.3);
      if (k <= 0) return;
      const e = 1 - (1 - k) * (1 - k);
      text(ctx, str, W / 2, H * (0.36 + i * 0.075) + (1 - e) * m * 0.05, size, color, 'center', e * (alpha == null ? 1 : alpha));
    };
    const big = Math.min(m * 0.085, W * 0.1);
    const mid = Math.min(m * 0.05, W * 0.06);
    line(0, 'SCORE ' + (game.score | 0), big, '#ffffff');
    line(1.2, 'BEST ' + (game.best | 0), mid, '#ffffff', 0.92);
    let next = 2.1;
    if (game.newBest) {
      const k = clamp01((ot - 0.35) / 0.3);
      if (k > 0) {
        const p = pulse(t, 6);
        ctx.save();
        ctx.translate(W / 2, H * (0.36 + next * 0.075));
        ctx.scale(easeOutBack(k) * (1 + p * 0.08), easeOutBack(k) * (1 + p * 0.08));
        ctx.rotate(-0.04);
        text(ctx, 'NEW BEST!', 0, 0, mid * 1.15, GOLD, 'center', k);
        ctx.restore();
      }
      next += 1;
    }
    const runCoins = game.runCoins != null ? game.runCoins : Math.max(0, (game.coins | 0) - coinsAtStart);
    const k = clamp01((ot - 0.15 - next * 0.08) / 0.3);
    if (k > 0) {
      const cs = mid * 0.9;
      const label = '+' + runCoins + (runCoins === 1 ? ' coin' : ' coins');
      ctx.font = '700 ' + Math.round(cs) + 'px ' + FONT;
      const tw = ctx.measureText(label).width;
      const r = cs * 0.36;
      const total = r * 2 + cs * 0.25 + tw;
      const y = H * (0.36 + next * 0.075) + (1 - k) * m * 0.05;
      const x0 = W / 2 - total / 2;
      ctx.globalAlpha = k;
      coinIcon(ctx, x0 + r, y, r);
      text(ctx, label, x0 + r * 2 + cs * 0.25, y + cs * 0.04, cs, '#ffffff', 'left', k);
    }

    if (ot > 0.5) {
      const pa = clamp01((ot - 0.5) / 0.3);
      const pp = pulse(t, 4.5);
      const pSize = Math.max(18, Math.min(m * 0.06, W * 0.068));
      const msg = game.isTouch ? 'tap to play again' : 'press SPACE to play again';
      ctx.save();
      ctx.translate(W / 2, H * 0.84);
      ctx.scale(1 + pp * 0.05, 1 + pp * 0.05);
      text(ctx, msg, 0, 0, pSize, '#ffffff', 'center', pa * (0.65 + 0.35 * pp));
      ctx.restore();
    }
  }

  // ---------- public ----------

  const ui = {
    draw(ctx, game, W, H) {
      if (!game) return;
      const t = now();
      const m = Math.min(W, H);
      const pad = Math.max(12, m * 0.035);

      if (game.state !== lastState) {
        if (game.state === 'play' && lastState !== 'play') {
          coinsAtStart = game.coins | 0;
          lastScore = game.score | 0;
        }
        lastState = game.state;
      }

      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      if (game.state === 'play' || game.state === 'dying') {
        drawDanger(ctx, game, W, H, t);
        drawHud(ctx, game, W, H, m, pad, t);
      } else if (game.state === 'title') {
        drawTitle(ctx, game, W, H, m, t);
      } else if (game.state === 'over') {
        drawOver(ctx, game, W, H, m, t);
      }

      if (game.paused && game.state !== 'over') drawPaused(ctx, game, W, H, m, t);

      ctx.globalAlpha = 1;
      drawMute(ctx, game, W, m, pad);
      ctx.restore();
    },

    hitMute(px, py) {
      const slop = 6;
      return px >= muteRect.x - slop && px <= muteRect.x + muteRect.w + slop &&
             py >= muteRect.y - slop && py <= muteRect.y + muteRect.h + slop;
    },
  };

  HH.ui = ui;
})();
