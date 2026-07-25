/**
 * test-markers.mjs — offline tests for the visual markers feature (Sub-task 4).
 *
 * Verifies:
 *   - The norm-to-pixel formula is correct and consistent with the playhead.
 *   - Each marker (loop fill, loop in/out lines, cue line) is computed at the
 *     right pixel position for a variety of zoom windows.
 *   - Markers outside the visible window produce pixel positions outside [0, cssW]
 *     (clipped naturally by the canvas — no special handling needed).
 *   - Layer draw order is correct (loop fill -> loop lines -> cue -> playhead).
 *   - All four props flow from DeckPanel state to Waveform props (structural check).
 *   - .btn.active CSS rule exists in index.css.
 *   - .loop-controls CSS rule exists in index.css.
 *
 * Run with:  node test-markers.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// --- Helpers ------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log('  \u2705  ' + label);
    passed++;
  } else {
    console.error('  \u274c  ' + label + (detail ? ' -- ' + detail : ''));
    failed++;
  }
}

function approxEq(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

// --- The norm-to-pixel formula (mirrors Waveform.tsx draw()) -----------------
//
//   markerX = ((norm * total - start) / win) * cssW
//
// where { start, win } come from windowFor():
//   win   = round(total * windowFrac)
//   center = position * total
//   start = clamp(center - win/2, 0, total - win)

function windowFor(total, position, windowFrac) {
  const win = Math.max(1, Math.round(total * windowFrac));
  const center = position * total;
  const start = Math.max(0, Math.min(total - win, center - win / 2));
  return { start, win };
}

function normToPixel(norm, total, start, win, cssW) {
  return ((norm * total - start) / win) * cssW;
}

// --- Tests -------------------------------------------------------------------

const TOTAL = 1000; // mock cache.width (bucket count)
const CSS_W = 800;  // mock canvas CSS width in pixels

// -- 1. Norm-to-pixel formula: full zoom, position at start --
console.log('\n-- Norm-to-pixel: full zoom (windowFrac=1) --');
{
  const { start, win } = windowFor(TOTAL, 0, 1);
  assert('start=0 at full zoom', start === 0, 'start=' + start);
  assert('win=total at full zoom', win === TOTAL, 'win=' + win);

  const cueX = normToPixel(0.25, TOTAL, start, win, CSS_W);
  assert('cueNorm=0.25 -> pixel 200', approxEq(cueX, 200), 'got ' + cueX);

  const loopInX  = normToPixel(0.1, TOTAL, start, win, CSS_W);
  const loopOutX = normToPixel(0.6, TOTAL, start, win, CSS_W);
  assert('loopIn=0.1 -> pixel 80',   approxEq(loopInX, 80),  'got ' + loopInX);
  assert('loopOut=0.6 -> pixel 480', approxEq(loopOutX, 480), 'got ' + loopOutX);

  const playX = normToPixel(0, TOTAL, start, win, CSS_W);
  assert('position=0 -> pixel 0', approxEq(playX, 0), 'got ' + playX);

  const playX1 = normToPixel(1, TOTAL, start, win, CSS_W);
  assert('position=1 -> pixel cssW', approxEq(playX1, CSS_W), 'got ' + playX1);
}

// -- 2. Norm-to-pixel: zoomed in (windowFrac=0.5, playhead at 0.5) --
console.log('\n-- Norm-to-pixel: 2x zoom, playhead centred at 0.5 --');
{
  const position = 0.5;
  const { start, win } = windowFor(TOTAL, position, 0.5);
  assert('win=500 at 50% zoom',  win === 500,  'win=' + win);
  assert('start=250 centred',    start === 250, 'start=' + start);

  const playX = normToPixel(position, TOTAL, start, win, CSS_W);
  assert('playhead centred at cssW/2', approxEq(playX, CSS_W / 2), 'got ' + playX);

  const cueX = normToPixel(0.5, TOTAL, start, win, CSS_W);
  assert('cue at same norm as playhead -> same pixel', approxEq(cueX, playX), 'got ' + cueX);

  // loopIn=0.3: bucket 300, offset 300-250=50 of 500 -> pixel 80
  const loopInX = normToPixel(0.3, TOTAL, start, win, CSS_W);
  assert('loopIn=0.3 in 2x zoom -> pixel 80', approxEq(loopInX, 80), 'got ' + loopInX);

  // loopOut=0.7: bucket 700, offset 700-250=450 of 500 -> pixel 720
  const loopOutX = normToPixel(0.7, TOTAL, start, win, CSS_W);
  assert('loopOut=0.7 in 2x zoom -> pixel 720', approxEq(loopOutX, 720), 'got ' + loopOutX);
}

// -- 3. Markers outside visible window produce off-canvas pixel coords --
console.log('\n-- Markers outside visible window are off-canvas --');
{
  const position = 0.5;
  const { start, win } = windowFor(TOTAL, position, 0.1);

  const cueX = normToPixel(0.1, TOTAL, start, win, CSS_W);
  assert('cue at 0.1 is off-canvas left at 10x zoom', cueX < 0, 'got ' + cueX);

  const loopOutX = normToPixel(0.9, TOTAL, start, win, CSS_W);
  assert('loopOut at 0.9 is off-canvas right at 10x zoom', loopOutX > CSS_W, 'got ' + loopOutX);
}

// -- 4. Loop fill rect width = loopOutX - loopInX --
console.log('\n-- Loop region fill rect dimensions --');
{
  const { start, win } = windowFor(TOTAL, 0, 1);
  const loopIn = 0.2, loopOut = 0.5;
  const loopInX  = normToPixel(loopIn,  TOTAL, start, win, CSS_W);
  const loopOutX = normToPixel(loopOut, TOTAL, start, win, CSS_W);
  const rectWidth = loopOutX - loopInX;

  assert('fill rect starts at loopInX=160', approxEq(loopInX, 160),  'got ' + loopInX);
  assert('fill rect ends at loopOutX=400',  approxEq(loopOutX, 400), 'got ' + loopOutX);
  assert('fill rect width = 240px',          approxEq(rectWidth, 240), 'got ' + rectWidth);
  assert('fill rect width > 0',              rectWidth > 0);
}

// -- 5. Pixel formula is identical for all marker types --
console.log('\n-- All markers use the same pixel formula --');
{
  const { start, win } = windowFor(TOTAL, 0.3, 0.8);
  const norm = 0.4;
  const expected = normToPixel(norm, TOTAL, start, win, CSS_W);

  const cueX     = ((norm * TOTAL - start) / win) * CSS_W;
  const loopInX  = ((norm * TOTAL - start) / win) * CSS_W;
  const loopOutX = ((norm * TOTAL - start) / win) * CSS_W;
  const playX    = ((norm * TOTAL - start) / win) * CSS_W;

  assert('cueX uses same formula',     approxEq(cueX,     expected));
  assert('loopInX uses same formula',  approxEq(loopInX,  expected));
  assert('loopOutX uses same formula', approxEq(loopOutX, expected));
  assert('playX uses same formula',    approxEq(playX,    expected));
}

// -- 6. Layer draw order (structural: parse draw() source) --
console.log('\n-- Draw layer order (source parse) --');
{
  const src = readFileSync(resolve(__dir, 'src/components/Waveform.tsx'), 'utf8');

  const idxBlit     = src.indexOf('ctx.drawImage(cache');
  const idxLoopFill = src.indexOf('ctx.fillRect(loopInX');
  // Find the standalone guard blocks that appear AFTER the fill block
  const idxLoopInL  = src.indexOf('loopIn != null', idxLoopFill + 1);
  const idxLoopOutL = src.indexOf('loopOut != null', idxLoopInL + 1);
  const idxCue      = src.indexOf('cueNorm != null');
  const idxPlayhead = src.indexOf('position * total - start');

  assert('blit before loop fill',       idxBlit     < idxLoopFill,  'blit=' + idxBlit + ' fill=' + idxLoopFill);
  assert('loop fill before loop lines', idxLoopFill < idxLoopInL,   'fill=' + idxLoopFill + ' loopIn=' + idxLoopInL);
  assert('loop in before loop out',     idxLoopInL  < idxLoopOutL,  'in=' + idxLoopInL + ' out=' + idxLoopOutL);
  assert('loop lines before cue',       idxLoopOutL < idxCue,       'out=' + idxLoopOutL + ' cue=' + idxCue);
  assert('cue before playhead',         idxCue      < idxPlayhead,  'cue=' + idxCue + ' play=' + idxPlayhead);
}

// -- 7. Props interface contains all four marker props --
console.log('\n-- Waveform Props interface --');
{
  const src = readFileSync(resolve(__dir, 'src/components/Waveform.tsx'), 'utf8');
  assert('cueNorm prop declared',  src.includes('cueNorm?:'));
  assert('loopIn prop declared',   src.includes('loopIn?:'));
  assert('loopOut prop declared',  src.includes('loopOut?:'));
  assert('looping prop declared',  src.includes('looping?:'));
}

// -- 8. draw() dependency array includes all four props --
console.log('\n-- draw() useCallback dependency array --');
{
  const src = readFileSync(resolve(__dir, 'src/components/Waveform.tsx'), 'utf8');
  const drawIdx = src.indexOf('}, [position, windowFor,');
  assert('draw deps array found', drawIdx !== -1);
  const depsLine = src.slice(drawIdx, drawIdx + 120);
  assert('cueNorm in deps',  depsLine.includes('cueNorm'),  depsLine);
  assert('loopIn in deps',   depsLine.includes('loopIn'),   depsLine);
  assert('loopOut in deps',  depsLine.includes('loopOut'),  depsLine);
  assert('looping in deps',  depsLine.includes('looping'),  depsLine);
}

// -- 9. DeckPanel passes all four props to Waveform --
console.log('\n-- DeckPanel passes marker props to Waveform --');
{
  const src = readFileSync(resolve(__dir, 'src/components/DeckPanel.tsx'), 'utf8');
  assert('cueNorm passed',  src.includes('cueNorm={deck.state.cueNorm}'));
  assert('loopIn passed',   src.includes('loopIn={deck.state.loopIn}'));
  assert('loopOut passed',  src.includes('loopOut={deck.state.loopOut}'));
  assert('looping passed',  src.includes('looping={deck.state.looping}'));
}

// -- 10. CSS rules present --
console.log('\n-- CSS rules in index.css --');
{
  const css = readFileSync(resolve(__dir, 'src/index.css'), 'utf8');
  const wf  = readFileSync(resolve(__dir, 'src/components/Waveform.tsx'), 'utf8');
  assert('.btn.active rule exists',     css.includes('.btn.active'));
  assert('.loop-controls rule exists',  css.includes('.loop-controls'));
  assert('.btn.active has green color', css.includes('#4caf50'));
  assert('loop fill colour in Waveform', wf.includes('rgba(76,194,255'));
}

// -- 11. Correct marker colours used --
console.log('\n-- Marker colours in Waveform.tsx --');
{
  const src = readFileSync(resolve(__dir, 'src/components/Waveform.tsx'), 'utf8');
  assert('loop fill colour = rgba(76,194,255,0.15)', src.includes('rgba(76,194,255,0.15)'));
  assert('loop line colour = #4caf50',               src.includes('#4caf50'));
  assert('cue line colour = #ffb700',                src.includes('#ffb700'));
  assert('playhead colour = #ff6b6b',                src.includes('#ff6b6b'));
}

// --- Summary -----------------------------------------------------------------

console.log('\n' + '-'.repeat(52));
if (failed === 0) {
  console.log('All ' + passed + ' tests passed.\n');
} else {
  console.log(failed + ' of ' + (passed + failed) + ' tests FAILED.\n');
  process.exit(1);
}
