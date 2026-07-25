/**
 * test-loop.mjs — offline test for the loop feature (Sub-task 3).
 *
 * This script verifies the reducer logic and audio-graph wrapping logic used in
 * the loop implementation WITHOUT needing a browser or Elementary runtime.
 *
 * Run with:  node test-loop.mjs
 */

// ─── Minimal reducer port (mirrors useDeck.ts) ───────────────────────────────

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function initialState() {
  return {
    playing: false,
    baseNorm: 0,
    seekGen: 0,
    tempo: 1,
    cueNorm: null,
    loopIn: null,
    loopOut: null,
    looping: false,
    track: { totalFrames: 44100, duration: 1 },
  };
}

function reducer(s, a) {
  switch (a.type) {
    case 'LOAD':
      return { ...s, playing: false, baseNorm: 0, seekGen: s.seekGen + 1,
               tempo: 1, cueNorm: null, loopIn: null, loopOut: null, looping: false };
    case 'PLAY':   return { ...s, playing: true };
    case 'PAUSE':  return { ...s, playing: false };
    case 'SEEK':   return { ...s, baseNorm: clamp01(a.norm), seekGen: s.seekGen + 1 };
    case 'SET_LOOP_IN': {
      const newLoopOut = s.loopOut !== null && s.loopOut <= a.norm ? null : s.loopOut;
      return { ...s, loopIn: clamp01(a.norm), loopOut: newLoopOut,
               looping: newLoopOut === null ? false : s.looping };
    }
    case 'SET_LOOP_OUT': {
      if (s.loopIn !== null && clamp01(a.norm) > s.loopIn) {
        return { ...s, loopOut: clamp01(a.norm), looping: true };
      }
      return { ...s, loopOut: clamp01(a.norm) };
    }
    case 'TOGGLE_LOOP': {
      if (s.looping) {
        return { ...s, looping: false, baseNorm: clamp01(a.currentPosition),
                 seekGen: s.seekGen + 1 };
      }
      if (s.loopIn !== null && s.loopOut !== null && s.loopOut > s.loopIn) {
        return { ...s, looping: true };
      }
      return s;
    }
    default: return s;
  }
}

// ─── Audio-rate floored-modulo wrap (mirrors buildDeckSignal) ─────────────────

function flooredModWrap(position, loopIn, loopOut) {
  const len = loopOut - loopIn;
  const offset = position - loopIn;
  return loopIn + (offset - len * Math.floor(offset / len));
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function approxEq(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n── Reducer: initial state ──');
{
  const s = initialState();
  assert('loopIn starts null',   s.loopIn === null);
  assert('loopOut starts null',  s.loopOut === null);
  assert('looping starts false', s.looping === false);
}

console.log('\n── Reducer: SET_LOOP_IN ──');
{
  let s = initialState();
  s = reducer(s, { type: 'SET_LOOP_IN', norm: 0.25 });
  assert('loopIn set to 0.25',   approxEq(s.loopIn, 0.25));
  assert('loopOut still null',   s.loopOut === null);
  assert('looping still false',  s.looping === false);
}

console.log('\n── Reducer: SET_LOOP_OUT arms loop ──');
{
  let s = initialState();
  s = reducer(s, { type: 'SET_LOOP_IN',  norm: 0.2 });
  s = reducer(s, { type: 'SET_LOOP_OUT', norm: 0.5 });
  assert('loopIn = 0.2',     approxEq(s.loopIn, 0.2));
  assert('loopOut = 0.5',    approxEq(s.loopOut, 0.5));
  assert('looping auto-armed', s.looping === true);
}

console.log('\n── Reducer: SET_LOOP_OUT before loopIn does NOT arm ──');
{
  let s = initialState();
  s = reducer(s, { type: 'SET_LOOP_IN',  norm: 0.6 });
  s = reducer(s, { type: 'SET_LOOP_OUT', norm: 0.3 }); // out < in
  assert('looping not armed when out < in', s.looping === false);
}

console.log('\n── Reducer: SET_LOOP_IN invalidates loopOut when loopIn >= loopOut ──');
{
  let s = initialState();
  s = reducer(s, { type: 'SET_LOOP_IN',  norm: 0.2 });
  s = reducer(s, { type: 'SET_LOOP_OUT', norm: 0.5 });
  // Now move loopIn to 0.7 — past loopOut
  s = reducer(s, { type: 'SET_LOOP_IN',  norm: 0.7 });
  assert('loopIn updated to 0.7',  approxEq(s.loopIn, 0.7));
  assert('loopOut reset to null',  s.loopOut === null);
  assert('looping reset to false', s.looping === false);
}

console.log('\n── Reducer: TOGGLE_LOOP on/off ──');
{
  let s = initialState();
  s = reducer(s, { type: 'SET_LOOP_IN',  norm: 0.1 });
  s = reducer(s, { type: 'SET_LOOP_OUT', norm: 0.4 });
  assert('looping armed after SET_LOOP_OUT', s.looping === true);

  // Toggle off — re-base the transport at the current wrapped position
  const currentPos = 0.25;
  const oldSeekGen = s.seekGen;
  s = reducer(s, { type: 'TOGGLE_LOOP', currentPosition: currentPos });
  assert('looping = false after toggle off',         s.looping === false);
  assert('baseNorm = currentPosition after exit',    approxEq(s.baseNorm, currentPos));
  assert('seekGen bumped on loop exit',              s.seekGen === oldSeekGen + 1);

  // Toggle on again
  s = reducer(s, { type: 'TOGGLE_LOOP', currentPosition: currentPos });
  assert('looping = true after toggle on',           s.looping === true);
}

console.log('\n── Reducer: TOGGLE_LOOP with no valid region is a no-op ──');
{
  let s = initialState();
  s = reducer(s, { type: 'TOGGLE_LOOP', currentPosition: 0.5 });
  assert('looping stays false when no region set', s.looping === false);
}

console.log('\n── Reducer: LOAD resets all loop state ──');
{
  let s = initialState();
  s = reducer(s, { type: 'SET_LOOP_IN',  norm: 0.1 });
  s = reducer(s, { type: 'SET_LOOP_OUT', norm: 0.4 });
  s = reducer(s, { type: 'LOAD', track: { totalFrames: 22050, duration: 0.5 } });
  assert('loopIn reset to null',   s.loopIn === null);
  assert('loopOut reset to null',  s.loopOut === null);
  assert('looping reset to false', s.looping === false);
}

console.log('\n── Audio graph: floored-modulo wrap ──');
{
  const loopIn = 0.2, loopOut = 0.5;

  // Position exactly at loopIn — should stay loopIn
  const w0 = flooredModWrap(loopIn, loopIn, loopOut);
  assert('pos=loopIn wraps to loopIn', approxEq(w0, loopIn), `got ${w0}`);

  // Position in the middle of the region — stays unchanged
  const w1 = flooredModWrap(0.35, loopIn, loopOut);
  assert('pos=0.35 stays 0.35', approxEq(w1, 0.35), `got ${w1}`);

  // Position exactly at loopOut — wraps back to loopIn
  const w2 = flooredModWrap(loopOut, loopIn, loopOut);
  assert('pos=loopOut wraps to loopIn', approxEq(w2, loopIn), `got ${w2}`);

  // Position one full loop-length past loopOut — wraps to loopIn
  const len = loopOut - loopIn;
  const w3 = flooredModWrap(loopOut + len, loopIn, loopOut);
  assert('pos=loopOut+len wraps to loopIn', approxEq(w3, loopIn), `got ${w3}`);

  // Position just before loopOut — stays unchanged
  const w4 = flooredModWrap(loopOut - 0.001, loopIn, loopOut);
  assert('pos just before loopOut stays in region', w4 >= loopIn && w4 < loopOut,
    `got ${w4}`);

  // Several positions uniformly sampled across two loop lengths stay inside [loopIn, loopOut].
  // Integer steps avoid FP accumulation in the loop counter.
  let allInside = true;
  const steps = 40;
  const range = (loopOut - loopIn) * 2; // covers two full loop lengths
  for (let i = 0; i <= steps; i++) {
    const p = loopIn + (range * i) / steps;
    const w = flooredModWrap(p, loopIn, loopOut);
    // Wrapped value must lie in [loopIn, loopOut] (loopOut itself wraps back to loopIn)
    if (w < loopIn - 1e-9 || w > loopOut + 1e-9) { allInside = false; break; }
  }
  assert('all sampled positions wrap into [loopIn, loopOut]', allInside);
}

console.log('\n── Audio graph: loop disabled uses raw position ──');
{
  // Simulate what buildDeckSignal does: only apply wrap when looping
  function readPosition(position, state) {
    if (state.looping && state.loopIn !== null && state.loopOut !== null) {
      return flooredModWrap(position, state.loopIn, state.loopOut);
    }
    return position;
  }

  let s = initialState();
  s = reducer(s, { type: 'SET_LOOP_IN',  norm: 0.2 });
  s = reducer(s, { type: 'SET_LOOP_OUT', norm: 0.5 });
  s = reducer(s, { type: 'TOGGLE_LOOP',  currentPosition: 0.35 });
  // Now off
  assert('raw position passes through when looping=false',
    approxEq(readPosition(0.75, s), 0.75));

  // Toggle back on
  s = reducer(s, { type: 'TOGGLE_LOOP', currentPosition: 0.35 });
  const w = readPosition(0.75, s);
  assert('position wraps when looping=true', w >= 0.2 && w < 0.5, `wrapped=${w}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed.\n`);
} else {
  console.log(`❌  ${failed} of ${passed + failed} tests FAILED.\n`);
  process.exit(1);
}
