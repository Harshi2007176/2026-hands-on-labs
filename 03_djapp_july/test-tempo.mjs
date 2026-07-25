/**
 * test-tempo.mjs — unit-tests the SET_TEMPO reducer logic and incPerSample
 * computation without React or Elementary (both are browser-only).
 *
 * Run with:  node test-tempo.mjs
 */

// ── Re-implement the pure pieces under test ─────────────────────────────────

function initialDeckState(id) {
  return {
    id,
    track: null,
    playing: false,
    baseNorm: 0,
    seekGen: 0,
    tempo: 1,
    volume: 1,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    filterCutoff: 0,
  };
}

function reducer(s, a) {
  switch (a.type) {
    case 'LOAD':
      return { ...s, track: a.track, playing: false, baseNorm: 0, seekGen: s.seekGen + 1, tempo: 1 };
    case 'SET_TEMPO':
      return { ...s, tempo: Math.max(0.5, Math.min(2.0, a.value)) };
    default:
      return s;
  }
}

/** incPerSample mirrors deck.ts buildDeckSignal() line 122 */
function incPerSample(tempo, totalFrames) {
  return tempo / Math.max(1, totalFrames - 1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    failed++;
  }
}

function assertApprox(a, b, label, tol = 1e-12) {
  assert(Math.abs(a - b) < tol, `${label} (got ${a}, expected ${b})`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n── SET_TEMPO reducer ──────────────────────────────────────────');

const s0 = initialDeckState('a');

// 1. Initial state
assert(s0.tempo === 1, 'initialDeckState sets tempo to 1');

// 2. Normal set
const s1 = reducer(s0, { type: 'SET_TEMPO', value: 1.5 });
assert(s1.tempo === 1.5, 'SET_TEMPO 1.5 is stored');

// 3. Lower boundary (exact)
const s2 = reducer(s0, { type: 'SET_TEMPO', value: 0.5 });
assert(s2.tempo === 0.5, 'SET_TEMPO 0.5 (min) is stored');

// 4. Upper boundary (exact)
const s3 = reducer(s0, { type: 'SET_TEMPO', value: 2.0 });
assert(s3.tempo === 2.0, 'SET_TEMPO 2.0 (max) is stored');

// 5. Below-minimum clamping
const s4 = reducer(s0, { type: 'SET_TEMPO', value: 0.1 });
assert(s4.tempo === 0.5, 'SET_TEMPO 0.1 is clamped to 0.5');

// 6. Above-maximum clamping
const s5 = reducer(s0, { type: 'SET_TEMPO', value: 5.0 });
assert(s5.tempo === 2.0, 'SET_TEMPO 5.0 is clamped to 2.0');

// 7. Negative value clamping
const s6 = reducer(s0, { type: 'SET_TEMPO', value: -1 });
assert(s6.tempo === 0.5, 'SET_TEMPO -1 is clamped to 0.5');

// 8. Other state fields are untouched
const s7 = reducer({ ...s0, eqLow: 6 }, { type: 'SET_TEMPO', value: 1.2 });
assert(s7.eqLow === 6, 'SET_TEMPO does not disturb other state fields');

// 9. LOAD resets tempo to 1 regardless of current value
const s8 = reducer(s3, { type: 'LOAD', track: { pathL: 'l', pathR: 'r', totalFrames: 1000 } });
assert(s8.tempo === 1, 'LOAD resets tempo to 1');

console.log('\n── incPerSample computation (deck.ts line 122) ─────────────────');

// Simulate a 44100-frame track (1 second at 44100 Hz).
const FRAMES = 44100;

// 10. At 1× the increment spans the whole buffer in exactly totalFrames steps.
assertApprox(incPerSample(1, FRAMES) * (FRAMES - 1), 1,
  '1× tempo: position advances from 0→1 in totalFrames-1 steps');

// 11. At 2× the increment doubles — playback finishes in half the real-time.
assertApprox(incPerSample(2, FRAMES), incPerSample(1, FRAMES) * 2,
  '2× tempo: incPerSample is exactly double the 1× value');

// 12. At 0.5× the increment halves — playback takes twice as long.
assertApprox(incPerSample(0.5, FRAMES), incPerSample(1, FRAMES) * 0.5,
  '0.5× tempo: incPerSample is exactly half the 1× value');

// 13. Tempo scaling is linear (1.5× halfway between 1× and 2×).
const base = incPerSample(1, FRAMES);
assertApprox(incPerSample(1.5, FRAMES), base * 1.5,
  '1.5× tempo: incPerSample scales linearly');

// 14. Guard against totalFrames=1 (edge case: single-frame "track").
assert(incPerSample(1, 1) === 1, 'totalFrames=1 edge case: Math.max(1,0) prevents divide-by-zero');

console.log('\n── Summary ──────────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
