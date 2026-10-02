// HOP-HOP audio: all sounds synthesized with Web Audio (no samples).
(function () {
  'use strict';
  const HH = (window.HH = window.HH || {});

  const MASTER_VOL = 0.55;
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let lastHop = 0;
  let hopStack = 0;

  function readMuted() {
    try {
      const key = (HH.STORAGE && HH.STORAGE.muted) || 'hophop.muted';
      return localStorage.getItem(key) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveMuted(b) {
    try {
      const key = (HH.STORAGE && HH.STORAGE.muted) || 'hophop.muted';
      localStorage.setItem(key, b ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  const audio = {
    muted: readMuted(),

    init() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -16;
          comp.knee.value = 12;
          comp.ratio.value = 4;
          comp.attack.value = 0.004;
          comp.release.value = 0.2;
          master = ctx.createGain();
          master.gain.value = audio.muted ? 0 : MASTER_VOL;
          master.connect(comp);
          comp.connect(ctx.destination);
          // 2 seconds of white noise, reused by all noisy sounds
          const len = Math.floor(ctx.sampleRate * 2);
          noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {
        ctx = null;
      }
    },

    setMuted(b) {
      audio.muted = !!b;
      saveMuted(audio.muted);
      if (ctx && master) {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(audio.muted ? 0 : MASTER_VOL, t + 0.12);
      }
    },

    play(name) {
      if (!ctx || audio.muted || ctx.state === 'closed') return;
      if (ctx.state === 'suspended') ctx.resume();
      const fn = SOUNDS[name];
      if (!fn) return;
      try {
        fn(ctx.currentTime + 0.005);
      } catch (e) { /* never let audio break the game */ }
    },
  };

  // ---------- building blocks ----------

  // Envelope gain node: quick attack, exponential decay to silence.
  function env(t, peak, attack, decay, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest || master);
    return g;
  }

  // Oscillator tone with optional pitch glide.
  function tone(t, type, f0, f1, peak, attack, decay, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const g = env(t, peak, attack, decay, dest);
    o.connect(g);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return o;
  }

  // Filtered noise burst. filterType e.g. 'lowpass'/'bandpass'/'highpass'.
  function noise(t, filterType, f0, f1, q, peak, attack, decay, dest) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const g = env(t, peak, attack, decay, dest);
    src.connect(f);
    f.connect(g);
    const off = Math.random() * 1.0;
    src.start(t, off);
    src.stop(t + attack + decay + 0.05);
    return src;
  }

  function note(n) { return 440 * Math.pow(2, (n - 69) / 12); } // midi -> Hz

  // ---------- sounds ----------
  const SOUNDS = {
    hop(t) {
      const now = ctx.currentTime;
      const gap = now - lastHop;
      lastHop = now;
      if (gap < 0.05) return;                       // hard limit
      hopStack = gap < 0.2 ? Math.min(hopStack + 1, 4) : 0;
      const vol = 0.22 * (1 - hopStack * 0.12);     // quieter under spam
      const p = 1 + (Math.random() - 0.5) * 0.12;
      tone(t, 'triangle', 380 * p, 760 * p, vol, 0.005, 0.09);
      tone(t, 'square', 380 * p, 700 * p, vol * 0.18, 0.005, 0.06);
    },

    bump(t) {
      tone(t, 'sine', 150, 70, 0.4, 0.004, 0.14);
      noise(t, 'lowpass', 400, 120, 1, 0.12, 0.003, 0.08);
    },

    coin(t) {
      tone(t, 'square', note(88), 0, 0.07, 0.003, 0.08);
      tone(t, 'sine', note(88), 0, 0.18, 0.003, 0.08);
      tone(t + 0.07, 'square', note(93), 0, 0.07, 0.003, 0.22);
      tone(t + 0.07, 'sine', note(93), 0, 0.2, 0.003, 0.25);
    },

    splash(t) {
      noise(t, 'bandpass', 2400, 500, 0.8, 0.38, 0.01, 0.45);
      noise(t, 'lowpass', 900, 200, 0.7, 0.2, 0.02, 0.35);
      tone(t + 0.04, 'sine', 600, 160, 0.25, 0.005, 0.16);   // bloop
      tone(t + 0.16, 'sine', 420, 900, 0.1, 0.005, 0.08);    // little bubble
    },

    crash(t) {
      noise(t, 'lowpass', 3000, 250, 0.6, 0.45, 0.003, 0.35);
      tone(t, 'sawtooth', 1200, 90, 0.13, 0.004, 0.4);       // descending zap
      tone(t, 'square', 900, 60, 0.06, 0.004, 0.32);
      // metallic clank: inharmonic partials
      [523, 1187, 1790, 2510].forEach((f, i) => {
        tone(t + 0.02, 'sine', f, f * 0.98, 0.09 / (i + 1), 0.002, 0.3 - i * 0.04);
      });
    },

    train(t) {
      // two-tone horn (minor third), slightly detuned saws through lowpass
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      lp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.05);
      g.gain.setValueAtTime(0.11, t + 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      lp.connect(g);
      g.connect(master);
      [311, 313.5, 370, 372.5].forEach((f) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        o.start(t);
        o.stop(t + 1.15);
      });
      noise(t, 'lowpass', 220, 140, 0.8, 0.25, 0.25, 1.1);  // rumble
    },

    bell(t) {
      for (let i = 0; i < 2; i++) {
        const s = t + i * 0.24;
        tone(s, 'sine', 1320, 0, 0.13, 0.002, 0.2);
        tone(s, 'triangle', 1980, 0, 0.04, 0.002, 0.14);
        tone(s, 'sine', 3100, 0, 0.02, 0.002, 0.07);
      }
    },

    eagle(t) {
      const dur = 0.7;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(2600, t);
      o.frequency.exponentialRampToValueAtTime(1100, t + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = 22;
      const vibG = ctx.createGain();
      vibG.gain.value = 90;
      vib.connect(vibG);
      vibG.connect(o.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2000;
      bp.Q.value = 1.2;
      const g = env(t, 0.13, 0.03, dur);
      o.connect(bp);
      bp.connect(g);
      o.start(t); vib.start(t);
      o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
      tone(t, 'sine', 2200, 1000, 0.06, 0.03, dur);
      noise(t, 'highpass', 3000, 2000, 0.7, 0.04, 0.03, dur * 0.7);
    },

    start(t) {
      [72, 76, 79].forEach((n, i) => {
        tone(t + i * 0.09, 'triangle', note(n), 0, 0.2, 0.005, 0.16);
        tone(t + i * 0.09, 'square', note(n), 0, 0.04, 0.005, 0.1);
      });
      tone(t + 0.27, 'triangle', note(84), 0, 0.18, 0.005, 0.3);
    },

    over(t) {
      [67, 63, 58].forEach((n, i) => {
        const s = t + i * 0.22;
        const last = i === 2;
        tone(s, 'triangle', note(n), last ? note(n) * 0.94 : 0, 0.2, 0.01, last ? 0.6 : 0.2);
        tone(s, 'sine', note(n - 12), 0, 0.1, 0.01, last ? 0.5 : 0.18);
      });
    },

    newbest(t) {
      [72, 76, 79, 84, 88].forEach((n, i) => {
        tone(t + i * 0.08, 'square', note(n), 0, 0.05, 0.004, 0.14);
        tone(t + i * 0.08, 'triangle', note(n), 0, 0.18, 0.004, 0.18);
      });
      const s = t + 0.42;
      [84, 88, 91].forEach((n) => tone(s, 'triangle', note(n), 0, 0.1, 0.01, 0.6));
    },

    click(t) {
      tone(t, 'square', 1500, 900, 0.06, 0.002, 0.04);
      tone(t, 'sine', 900, 600, 0.12, 0.002, 0.05);
    },
  };

  HH.audio = audio;
})();
