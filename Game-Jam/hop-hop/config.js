// HOP-HOP shared config. Loaded first. Everything hangs off window.HH.
'use strict';
const HH = (window.HH = window.HH || {});

HH.COLS = 9;            // playable columns 0..8 (x is tile LEFT edge; tile center = x + 0.5)
HH.PAD = 14;            // lanes/traffic extend this many tiles beyond each side (out of bounds decor)
HH.HOP_TIME = 0.14;     // seconds per hop
HH.LEVEL = { grass: 0, road: 0, rail: 0, river: -0.18 }; // ground surface height per lane type (tile units)
HH.LOG_TOP = 0.06;      // standing height on a log
HH.STORAGE = { best: 'hophop.best', coins: 'hophop.coins', muted: 'hophop.muted' };

HH.PAL = {
  grassA: '#9fe3a6', grassB: '#c3e97f', tuftA: '#6fc47c', tuftB: '#94c955',
  dirt: '#a2774f', dirtDark: '#7d5a3a',
  road: '#3b3d48', roadEdge: '#4a4c58', laneLine: '#f4e7c5',
  water: '#1d8a91', waterDeep: '#167178', ripple: 'rgba(255,255,255,0.55)',
  gravel: '#9a8676', sleeper: '#6b4a33', rail: '#a65a33', railTop: '#d08a5c',
  trunkTop: '#9a6744', trunkSide: '#6e4630',
  leaf: [['#6fd08a', '#3f9a5a'], ['#8bd96b', '#529a3c'], ['#5cc29a', '#2f8a66']], // [top, side]
  rockTop: '#d6d0c4', rockSide: '#9a9387',
  logTop: '#b07a4a', logSide: '#7f5230', logRing: '#e3b98a', logRingDark: '#9c6a3e',
  cars: [['#ff7aa8', '#d4507e'], ['#ffd84d', '#d9aa1f'], ['#5cc8ff', '#2f97d1'],
         ['#ff9b4d', '#d4702a'], ['#b48bff', '#8460d6'], ['#4de0b0', '#25b086']],
  truckCargo: ['#fff6e6', '#d9ccb4'],
  trainTop: '#e8483f', trainSide: '#b0302b', trainStripe: '#fff1d6',
  amber: '#ffb52e',
  robotTop: '#c9def5', robotSide: '#7d9cc4', robotMid: '#a3c0e3', robotDark: '#4a5d78',
  eye: '#5ff6ff', eyeGlow: 'rgba(95,246,255,0.8)',
  coinTop: '#ffd94a', coinSide: '#e0a91c',
  eagleTop: '#8a5a8f', eagleSide: '#5e3a63', beak: '#ffab2e',
  ui: '#ffffff', uiShadow: 'rgba(30,40,60,0.35)',
};
