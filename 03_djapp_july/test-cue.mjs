// Headless unit test for the cue-point reducer logic.
// Mirrors the reducer in useDeck.ts using the same rules.
// Run: node test-cue.mjs

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function initialState() {
  return {
    track: { name: 'test.mp3', duration: 180, totalFrames: 44100 * 180, peaks: null, pathL: 'L', pathR: 'R' },
    playing: false,
    baseNorm: 0,
    seekGen: 0,
    tempo: 1,
    volume: 1,
    eqLow: 0, eqMid: 0, eqHigh: 0,
    filterCutoff: 0,
    cueNorm: null,
  };
}

function reducer(s, a) {
  switch (a.type) {
    case 'LOAD':
      return { ...s, track: a.track, playing: false, baseNorm: 0, seekGen: s.seekGen + 1, tempo: 1, cueNorm: null };
    case 'PLAY':
      return s.track ? { ...s, playing: true } : s;
    case 'PAUSE':
      return { ...s, playing: false };
    case 'SEEK':
      return s.track ? { ...s, baseNorm: clamp01(a.norm), seekGen: s.seekGen + 1 } : s;
    case 'END':
      return { ...s, playing: false, baseNorm: 0, seekGen: s.seekGen + 1 };
    case 'SET_CUE':
      return { ...s, cueNorm: clamp01(a.norm) };
    case 'GO_CUE':
      if (s.cueNorm === null) return s;
      return { ...s, playing: false, baseNorm: s.cueNorm, seekGen: s.seekGen + 1 };
    default:
      return s;
  }
}

let pass = 0;
let fail = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    fail++;
  }
}

// ── Initial state ─────────────────────────────────────────────────────────────
console.log('\n[1] Initial state');
const s0 = initialState();
assert('cueNorm starts null', s0.cueNorm === null);

// ── SET_CUE stores current position ──────────────────────────────────────────
console.log('\n[2] SET_CUE stores norm');
const s1 = reducer(reducer(s0, { type: 'PLAY' }), { type: 'SET_CUE', norm: 0.42 });
assert('cueNorm is 0.42', s1.cueNorm === 0.42);
assert('playing unchanged (still true)', s1.playing === true);
assert('seekGen unchanged', s1.seekGen === s0.seekGen);

// ── SET_CUE clamps to [0,1] ───────────────────────────────────────────────────
console.log('\n[3] SET_CUE clamps');
const sOver = reducer(s0, { type: 'SET_CUE', norm: 1.5 });
assert('cueNorm clamped to 1', sOver.cueNorm === 1);
const sUnder = reducer(s0, { type: 'SET_CUE', norm: -0.3 });
assert('cueNorm clamped to 0', sUnder.cueNorm === 0);

// ── GO_CUE while playing → pause + seek to cueNorm ───────────────────────────
console.log('\n[4] GO_CUE while playing');
const sPlaying = reducer(reducer(s0, { type: 'PLAY' }), { type: 'SET_CUE', norm: 0.25 });
const sGo = reducer(sPlaying, { type: 'GO_CUE' });
assert('playing becomes false', sGo.playing === false);
assert('baseNorm set to cueNorm (0.25)', sGo.baseNorm === 0.25);
assert('seekGen bumped', sGo.seekGen === sPlaying.seekGen + 1);

// ── GO_CUE while stopped → seeks to cueNorm ──────────────────────────────────
console.log('\n[5] GO_CUE while stopped');
const sStopped = reducer(s0, { type: 'SET_CUE', norm: 0.6 });
const sGo2 = reducer(sStopped, { type: 'GO_CUE' });
assert('playing stays false', sGo2.playing === false);
assert('baseNorm set to 0.6', sGo2.baseNorm === 0.6);
assert('seekGen bumped', sGo2.seekGen === sStopped.seekGen + 1);

// ── GO_CUE with no cue set → no-op ───────────────────────────────────────────
console.log('\n[6] GO_CUE with no cue (no-op)');
const sNoCue = reducer(s0, { type: 'GO_CUE' });
assert('state unchanged (same seekGen)', sNoCue.seekGen === s0.seekGen);
assert('baseNorm still 0', sNoCue.baseNorm === 0);
assert('cueNorm still null', sNoCue.cueNorm === null);

// ── LOAD resets cueNorm ───────────────────────────────────────────────────────
console.log('\n[7] LOAD clears cueNorm');
const sWithCue = reducer(s0, { type: 'SET_CUE', norm: 0.77 });
const sLoaded = reducer(sWithCue, { type: 'LOAD', track: { name: 'new.mp3' } });
assert('cueNorm reset to null after LOAD', sLoaded.cueNorm === null);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nResults: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
