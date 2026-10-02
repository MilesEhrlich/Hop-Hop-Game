# HOP-HOP module contract (read fully before coding)

Plain vanilla JS, no modules/bundler. Scripts load in this order via <script> tags, each file
wraps itself in an IIFE `(function(){ 'use strict'; ... })();` and attaches to `window.HH`:

  config.js  (exists)  -> HH.COLS, HH.PAD, HH.HOP_TIME, HH.LEVEL, HH.LOG_TOP, HH.STORAGE, HH.PAL
  audio.js   (agent C) -> HH.audio
  fx.js      (agent C) -> HH.fx
  render.js  (agent B) -> HH.render
  ui.js      (agent C) -> HH.ui
  game.js    (agent A) -> HH.game (state object) + main loop, input, lane generation, collisions
  index.html / style.css (agent A)

Never reference another module at load time (only inside functions), so load order is forgiving.

## Coordinates
- World x: tile units, x = LEFT edge of a tile; tile col c spans [c, c+1], center c+0.5. Playable cols 0..COLS-1.
- Row: integer lane index, increases going FORWARD (up the screen). Lane `r` spans rows [r, r+1]
  (r = near/south edge, r+1 = far edge). Continuous values allowed (player.y during hops).
- z: height in tile units above 0. Lanes have surface height HH.LEVEL[type] (river is -0.18).
- View: slightly angled top-down. We see TOP faces and the SOUTH (front, toward viewer) face only.

## Projection (owned by HH.render, used by fx/ui)
HH.render.resize(cssW, cssH)  -> recompute TW (tile width px), TD (=0.78*TW, screen px per row), HS (=0.62*TW, px per z unit),
                                  W, H. TW = max(cssW/30, min(cssW/10.5, cssH/11.5)).
HH.render.sx(x)        = (x - cam.x) * TW + W/2
HH.render.sy(row, z)   = H*0.64 - (row - cam.row) * TD - z * HS      (cam from HH.game.cam; include shake offset)
HH.render.TW / TD / HS / W / H  (numbers, updated on resize)
HH.render.visibleRange() -> {minRow, maxRow, minX, maxX} world ranges currently on screen (+1 margin)
HH.render.draw(ctx, game)  draws the whole world: ground of every visible lane far->near, lane flat stuff
  (lines, rails, logs, ripples), soft shadows, depth-sorted objects (trees, rocks, cars, trucks, trains,
  crossing lights, coins, player robot, eagle), then calls HH.fx.draw(ctx). Does NOT draw HUD.
HH.render.drawRobotIcon? not needed.

## HH.game (state object created by game.js; renderer/ui only READ it)
{
  state: 'title' | 'play' | 'dying' | 'over',
  paused: bool, time: seconds since load (keeps running for anims, frozen while paused),
  lanes: Map<int row, Lane>, minRow, maxRow,
  player: {
    x, y, z,            // x left edge (continuous on logs), y row (continuous while hopping), z extra hop height
    groundZ,            // surface height under feet (LEVEL or LOG_TOP), add to z when drawing
    facing: 'up'|'down'|'left'|'right',
    hopT,               // 0..1 progress of current hop, or -1 when idle
    squash,             // spring value ~[-0.35, 0.3]; >0 stretch tall, <0 squash flat. Renderer: scaleY = 1+squash, scaleX = 1-squash*0.6
    antenna,            // antenna wobble angle in radians (spring)
    blink,              // 0..1 eye openness (1 open)
    visible: bool,      // false after exploding / grabbed handled by eagle
    sink,               // 0..1 when drowning (draw robot lowered by sink*0.6 and faded)
  },
  cam: { x, row, shake },   // shake = current pixel shake magnitude (renderer adds random offset)
  score, best, coins, newBest: bool,
  deathCause: null | 'car' | 'train' | 'water' | 'eagle',
  eagle: null | { x, row, z, flap /*radians*/, carrying: bool },   // x is CENTER x for the eagle
  danger: 0..1,             // how close the eagle is to swooping (ui may draw a pulsing edge vignette)
  overT: seconds since game over screen appeared,
  muted: bool, isTouch: bool,
}

## Lane objects
Common: { row, type: 'grass'|'road'|'river'|'rail', coins: [{col, taken:bool, phase}] , seed (0..1 random for variety) }
- grass: { shade: 0|1 (alternate mint/lime), obstacles: [{col, kind:'tree'|'rock', tiers:1..3, variant:0..2}],
           tufts: [{x, r, s}] (x world, r 0..1 within lane, s size 0.5..1) }   obstacles may have col <0 or >=COLS (decor)
- road:  { dir: 1|-1, speed, vehicles: [{x, len, kind:'car'|'truck', color: index into PAL.cars}],
           lineAbove: bool (draw dashed cream line along far edge because lane row+1 is also road) }
- river: { dir, speed, logs: [{x, len}], ripples: [{x, r, phase}] }   ripples drift with current
- rail:  { train: { state:'idle'|'warn'|'pass', t, x, dir, cars, len }, light: bool (amber lamp on this frame) }
         train occupies [x, x+len] while 'pass'; locomotive is at the leading end (x+len if dir=1, x if dir=-1)
         crossing light post should be drawn at x = -0.6 (just left of playfield) and at COLS+0.6.

## HH.fx (agent C) — particles in WORLD space, drawn with HH.render.sx/sy
fx.clear(); fx.update(dt); fx.draw(ctx)
fx.dust(x, row, z)         landing puffs (x,row = center point)
fx.sparkle(x, row, z)      coin twinkles / pickup burst
fx.explode(x, row, z)      robot hit: sparks (streaks) + little bolts/nuts tumbling + smoke
fx.splash(x, row, z)       splash ring(s) expanding on water + droplets
fx.popup(x, row, z, text)  floating text like "+1" rising and fading
fx.feathers(x,row,z)       optional small burst when eagle grabs

## HH.audio (agent C) — Web Audio, synthesized only
audio.init() (call on first user gesture; safe to call repeatedly), audio.play(name),
audio.setMuted(bool), audio.muted
names: 'hop','bump','coin','splash','crash','train','bell','eagle','start','over','newbest','click'

## HH.ui (agent C)
ui.draw(ctx, game, W, H)   HUD (score top-left w/ "BEST n" under it, coins top-right, mute icon), title screen,
                           pause screen, game over screen. Big rounded bold text with soft drop shadow, no boxes.
ui.hitMute(px, py) -> bool  whether css-pixel point hits the mute icon (game.js routes clicks/taps).
Font: '"Fredoka", "Nunito", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif' (index.html loads Fredoka from Google Fonts).
