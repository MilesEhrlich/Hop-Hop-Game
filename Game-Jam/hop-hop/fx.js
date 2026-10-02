// HOP-HOP particle effects, simulated in WORLD coords and projected via HH.render.
(function () {
  'use strict';
  const HH = (window.HH = window.HH || {});

  const MAX = 400;
  const FONT = '"Fredoka", "Nunito", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
  const TAU = Math.PI * 2;

  const parts = [];   // live particles
  const pool = [];    // recycled particle objects

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // Spawn a particle (returns null if at cap).
  function spawn(type, x, row, z, o) {
    if (parts.length >= MAX) return null;
    const p = pool.pop() || {};
    p.type = type;
    p.x = x; p.row = row; p.z = z;
    p.vx = o.vx || 0; p.vrow = o.vrow || 0; p.vz = o.vz || 0;
    p.gravity = o.gravity || 0;
    p.drag = o.drag || 0;
    p.life = p.maxLife = o.life || 0.5;
    p.color = o.color || '#fff';
    p.size = o.size || 0.1;
    p.grow = o.grow || 0;          // size multiplier gained over lifetime
    p.rot = o.rot != null ? o.rot : rand(0, TAU);
    p.vrot = o.vrot || 0;
    p.floor = o.floor != null ? o.floor : -Infinity;
    p.bounces = o.bounces || 0;
    p.text = o.text || '';
    p.phase = rand(0, TAU);
    parts.push(p);
    return p;
  }

  const fx = {
    clear() {
      while (parts.length) pool.push(parts.pop());
    },

    update(dt) {
      if (!(dt > 0)) return;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) {
          parts[i] = parts[parts.length - 1];
          parts.pop();
          pool.push(p);
          continue;
        }
        if (p.drag) {
          const k = Math.max(0, 1 - p.drag * dt);
          p.vx *= k; p.vrow *= k; p.vz *= k;
        }
        p.vz -= p.gravity * dt;
        p.x += p.vx * dt;
        p.row += p.vrow * dt;
        p.z += p.vz * dt;
        p.rot += p.vrot * dt;
        if (p.type === 'feather') {
          p.vz = Math.max(p.vz, -0.45);
          p.phase += dt * 4;
        }
        if (p.z < p.floor) {
          p.z = p.floor;
          if (p.bounces > 0 && p.vz < 0) {
            p.bounces--;
            p.vz = -p.vz * 0.4;
            p.vx *= 0.6; p.vrow *= 0.6; p.vrot *= 0.5;
          } else {
            p.vz = 0; p.vx *= 0.8; p.vrow *= 0.8; p.vrot *= 0.8;
            if (p.type === 'drop') p.life = Math.min(p.life, 0.05);
          }
        }
      }
    },

    draw(ctx) {
      const R = HH.render;
      if (!R || !parts.length) return;
      const TW = R.TW, TD = R.TD;
      const flat = TD / TW;
      ctx.save();
      let hasText = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type === 'text') { hasText = true; continue; }
        drawPart(ctx, p, R.sx(p.x), R.sy(p.row, p.z), TW, flat, R);
      }
      if (hasText) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (p.type === 'text') drawText(ctx, p, R.sx(p.x), R.sy(p.row, p.z), TW);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    },

    dust(x, row, z) {
      const n = 5 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand(-0.3, 0.3);
        const sp = rand(0.9, 1.5);
        spawn('puff', x + Math.cos(a) * 0.12, row + Math.sin(a) * 0.1, z + 0.02, {
          vx: Math.cos(a) * sp, vrow: Math.sin(a) * sp * 0.8, vz: rand(0.05, 0.25),
          drag: 6, life: rand(0.35, 0.5), size: rand(0.06, 0.09), grow: 1.6,
          color: pick(['#fff8e8', '#ffffff', '#f6ecd4']),
        });
      }
    },

    sparkle(x, row, z) {
      spawn('ring', x, row, z + 0.25, { life: 0.3, size: 0.1, grow: 4, color: '#fff3b0' });
      for (let i = 0; i < 7; i++) {
        const a = rand(0, TAU);
        const sp = rand(0.6, 1.6);
        spawn('star', x, row, z + 0.25, {
          vx: Math.cos(a) * sp, vrow: Math.sin(a) * sp * 0.4, vz: rand(0.6, 2.0),
          drag: 3.5, gravity: 1.5, life: rand(0.35, 0.6), size: rand(0.07, 0.13),
          vrot: rand(-4, 4), color: pick(['#ffd94a', '#fff6c2', '#ffffff', '#ffe27a']),
        });
      }
    },

    explode(x, row, z) {
      const floor = Math.min(z, 0);
      spawn('flash', x, row, z + 0.35, { life: 0.16, size: 0.5, grow: 1.8, color: '#ffffff' });
      for (let i = 0; i < 30; i++) {
        const a = rand(0, TAU);
        const sp = rand(2.5, 6.5);
        spawn('spark', x, row, z + 0.35, {
          vx: Math.cos(a) * sp, vrow: Math.sin(a) * sp * 0.6, vz: rand(0.5, 5),
          gravity: 9, drag: 1.5, life: rand(0.3, 0.65), size: rand(0.03, 0.05),
          color: pick(['#fff3a0', '#ffc23d', '#ff8a2e', '#ffffff']), floor: floor,
        });
      }
      for (let i = 0; i < 8; i++) {
        const a = rand(0, TAU);
        const sp = rand(1, 2.8);
        spawn(i % 2 ? 'nut' : 'bolt', x, row, z + 0.35, {
          vx: Math.cos(a) * sp, vrow: Math.sin(a) * sp * 0.6, vz: rand(2.5, 4.5),
          gravity: 12, life: rand(1.0, 1.4), size: rand(0.07, 0.1),
          vrot: rand(-14, 14), color: pick(['#c8ccd6', '#9aa2b1', '#e1e5ec']),
          floor: floor, bounces: 1,
        });
      }
      for (let i = 0; i < 5; i++) {
        spawn('smoke', x + rand(-0.2, 0.2), row + rand(-0.15, 0.15), z + rand(0.2, 0.5), {
          vx: rand(-0.4, 0.4), vrow: rand(-0.2, 0.2), vz: rand(0.4, 0.9),
          drag: 1.5, life: rand(0.6, 0.9), size: rand(0.14, 0.2), grow: 1.8,
          color: pick(['#8d8f99', '#a8aab3', '#74767f']),
        });
      }
    },

    splash(x, row, z) {
      spawn('wring', x, row, z, { life: 0.6, size: 0.12, grow: 4.5, color: '#ffffff' });
      spawn('wring', x, row, z, { life: 0.8, size: 0.05, grow: 7, color: '#ffffff' });
      for (let i = 0; i < 14; i++) {
        const a = rand(0, TAU);
        const sp = rand(0.4, 1.6);
        spawn('drop', x, row, z + 0.05, {
          vx: Math.cos(a) * sp, vrow: Math.sin(a) * sp * 0.6, vz: rand(2, 4.2),
          gravity: 11, life: 1.2, size: rand(0.035, 0.06),
          color: pick(['#ffffff', '#d8f6ff', '#bff0f5']), floor: z,
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = rand(0, TAU);
        spawn('puff', x + Math.cos(a) * 0.15, row + Math.sin(a) * 0.12, z + 0.03, {
          vx: Math.cos(a) * 0.6, vrow: Math.sin(a) * 0.4, drag: 3,
          life: rand(0.45, 0.7), size: rand(0.08, 0.12), grow: 1.3, color: '#f2fdff',
        });
      }
    },

    popup(x, row, z, text) {
      spawn('text', x, row, z + 0.6, {
        vz: 3.4, drag: 2.2,  // ~0.8 tile of screen rise over 0.8s
        life: 0.8, size: 0.42, text: String(text),
        color: '#ffd94a', rot: 0,
      });
    },

    feathers(x, row, z) {
      for (let i = 0; i < 6; i++) {
        spawn('feather', x + rand(-0.3, 0.3), row + rand(-0.2, 0.2), z + rand(0.3, 0.7), {
          vx: rand(-0.8, 0.8), vrow: rand(-0.3, 0.3), vz: rand(0.4, 1.2),
          gravity: 2, drag: 1.2, life: rand(1.2, 1.8), size: rand(0.12, 0.17),
          rot: rand(-0.6, 0.6), color: pick(['#8a5a8f', '#a375a8', '#5e3a63']),
        });
      }
    },
  };

  // ---------- drawing ----------

  function drawPart(ctx, p, X, Y, TW, flat, R) {
    const t = 1 - p.life / p.maxLife;     // 0 -> 1 over lifetime
    const fade = p.life / p.maxLife;      // 1 -> 0
    const s = p.size * TW * (1 + p.grow * t);
    switch (p.type) {
      case 'puff':
      case 'smoke': {
        ctx.globalAlpha = (p.type === 'smoke' ? 0.55 : 0.8) * fade;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(X, Y, s, 0, TAU);
        ctx.fill();
        break;
      }
      case 'star': {
        const k = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;  // pop in then shrink
        ctx.globalAlpha = Math.min(1, fade * 1.5);
        ctx.fillStyle = p.color;
        star4(ctx, X, Y, s * (0.4 + k), p.rot);
        break;
      }
      case 'ring': {
        ctx.globalAlpha = 0.9 * fade;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, TW * 0.05 * fade);
        ctx.beginPath();
        ctx.arc(X, Y, s, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'wring': {
        ctx.globalAlpha = 0.85 * fade;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, TW * 0.045 * fade);
        ctx.beginPath();
        ctx.ellipse(X, Y, s, s * flat, 0, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'flash': {
        ctx.globalAlpha = 0.85 * fade;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(X, Y, s, 0, TAU);
        ctx.fill();
        break;
      }
      case 'spark': {
        // streak along screen-space velocity
        const vxs = p.vx * TW;
        const vys = -p.vrow * R.TD - p.vz * R.HS;
        const len = 0.045;
        ctx.globalAlpha = Math.min(1, fade * 1.6);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, s);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X - vxs * len, Y - vys * len);
        ctx.stroke();
        break;
      }
      case 'bolt':
      case 'nut': {
        ctx.globalAlpha = Math.min(1, fade * 3);
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#5d6473';
        ctx.lineWidth = Math.max(1, s * 0.18);
        if (p.type === 'nut') {
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            if (k) ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
            else ctx.moveTo(Math.cos(a) * s, Math.sin(a) * s);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#5d6473';
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.4, 0, TAU);
          ctx.fill();
        } else {
          ctx.fillRect(-s * 0.25, -s * 0.2, s * 1.5, s * 0.4);  // shaft
          ctx.fillRect(-s * 0.7, -s * 0.55, s * 0.5, s * 1.1);  // head
          ctx.strokeRect(-s * 0.7, -s * 0.55, s * 0.5, s * 1.1);
        }
        ctx.restore();
        break;
      }
      case 'drop': {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(X, Y, s, 0, TAU);
        ctx.fill();
        break;
      }
      case 'feather': {
        ctx.globalAlpha = Math.min(1, fade * 2.5);
        ctx.save();
        ctx.translate(X + Math.sin(p.phase) * TW * 0.12, Y);
        ctx.rotate(p.rot + Math.sin(p.phase) * 0.6);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, s, s * 0.32, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = Math.max(1, s * 0.08);
        ctx.beginPath();
        ctx.moveTo(-s * 1.15, 0);
        ctx.lineTo(s * 0.9, 0);
        ctx.stroke();
        ctx.restore();
        break;
      }
    }
  }

  function star4(ctx, x, y, r, rot) {
    const ri = r * 0.32;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = rot + (k / 8) * TAU;
      const rr = k % 2 ? ri : r;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawText(ctx, p, X, Y, TW) {
    const t = 1 - p.life / p.maxLife;
    const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1 - Math.min(0.1, (t - 0.15));
    const px = Math.max(12, Math.round(p.size * TW * pop));
    ctx.font = '700 ' + px + 'px ' + FONT;
    ctx.globalAlpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
    ctx.fillStyle = 'rgba(30,40,60,0.35)';
    ctx.fillText(p.text, X + px * 0.05, Y + px * 0.09);
    ctx.lineWidth = Math.max(2, px * 0.14);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(p.text, X, Y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, X, Y);
  }

  HH.fx = fx;
})();
