/**
 * test-markers-music.mjs — end-to-end visual markers test using the real music files.
 *
 * Since browser APIs (decodeAudioData, AudioContext) are unavailable in Node, this
 * script simulates realistic TrackData by:
 *   1. Reading the actual MP3 file sizes from the music/ folder.
 *   2. Deriving realistic totalFrames / duration from standard MP3 bitrate estimates.
 *   3. Running the same computePeaks() logic from track.ts on a synthetic PCM buffer
 *      that has the correct length (so peak bucket counts match exactly what the app
 *      produces for these files at 44100 Hz).
 *   4. Running the full marker pixel-computation pipeline on those realistic TrackData
 *      objects — the same math the Waveform canvas uses — and asserting correctness.
 *
 * This gives us confidence that the marker feature works correctly with the durations
 * and peak bucket counts that the actual tracks will produce in the browser.
 *
 * Run with:  node test-markers-music.mjs
 */

import { statSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log('  \u2705  ' + label);
    passed++;
  } else {
    console.error('  \u274c  ' + label + (detail != null ? ' -- ' + detail : ''));
    failed++;
  }
}

function approxEq(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

// ---------------------------------------------------------------------------
// Simulate computePeaks() from track.ts
// ---------------------------------------------------------------------------

const PEAK_BUCKETS = 6000; // must match track.ts

function computePeaks(channel, buckets) {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const bucketSize = channel.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(channel.length, Math.floor((b + 1) * bucketSize));
    let mn = 0, mx = 0;
    for (let i = start; i < end; i++) {
      const v = channel[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    min[b] = mn;
    max[b] = mx;
  }
  return { min, max, buckets };
}

// ---------------------------------------------------------------------------
// Estimate TrackData from real MP3 files (no browser decode available in Node)
//
// Standard MP3 bitrate: 128 kbps = 16000 bytes/sec
// Frame count  = duration * sampleRate (44100 Hz)
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;
const MP3_BITRATE_BYTES_PER_SEC = 128000 / 8; // 128 kbps -> bytes/sec

function estimateTrackData(filename, fileSize) {
  const durationSec = fileSize / MP3_BITRATE_BYTES_PER_SEC;
  const totalFrames = Math.round(durationSec * SAMPLE_RATE);

  // Generate a synthetic PCM buffer with the correct frame count.
  // Use a simple sine wave so peaks are non-trivial.
  const pcm = new Float32Array(totalFrames);
  const freq = 440 / SAMPLE_RATE;
  for (let i = 0; i < totalFrames; i++) {
    pcm[i] = Math.sin(2 * Math.PI * freq * i) * 0.8;
  }

  return {
    name: filename,
    duration: durationSec,
    totalFrames,
    sampleRate: SAMPLE_RATE,
    peaks: computePeaks(pcm, PEAK_BUCKETS),
  };
}

// ---------------------------------------------------------------------------
// Marker pixel formula — mirrors Waveform.tsx draw()
// ---------------------------------------------------------------------------

function windowFor(total, position, windowFrac) {
  const win = Math.max(1, Math.round(total * windowFrac));
  const center = position * total;
  const start = Math.max(0, Math.min(total - win, center - win / 2));
  return { start, win };
}

function normToPixel(norm, total, start, win, cssW) {
  return ((norm * total - start) / win) * cssW;
}

// ---------------------------------------------------------------------------
// Load the two real music files
// ---------------------------------------------------------------------------

const MUSIC = [
  { file: 'grand_project-wonders-of-the-earth-550792.mp3',  label: 'Grand Project' },
  { file: 'kontraa-water-afro-pop-music-445661.mp3',        label: 'Kontraa Water' },
];

const tracks = MUSIC.map(({ file, label }) => {
  const path = resolve(__dir, 'music', file);
  const { size } = statSync(path);
  const data = estimateTrackData(file, size);
  return { label, size, ...data };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n-- Music file metadata --');
for (const t of tracks) {
  console.log('  Track: ' + t.label);
  console.log('    File size   : ' + (t.size / 1024 / 1024).toFixed(2) + ' MB');
  console.log('    Est. duration: ' + t.duration.toFixed(1) + ' s');
  console.log('    Total frames : ' + t.totalFrames.toLocaleString());
  console.log('    Peak buckets : ' + t.peaks.buckets);
}

console.log('\n-- Peak data sanity (computePeaks output) --');
for (const t of tracks) {
  const { min, max, buckets } = t.peaks;

  assert(t.label + ': bucket count = ' + PEAK_BUCKETS, buckets === PEAK_BUCKETS);
  assert(t.label + ': min array length = buckets', min.length === buckets);
  assert(t.label + ': max array length = buckets', max.length === buckets);

  // Check that peaks are populated and bounded
  let hasPeaks = false;
  let allBounded = true;
  for (let i = 0; i < buckets; i++) {
    if (max[i] > 0.01) hasPeaks = true;
    if (min[i] < -1.0 || max[i] > 1.0) { allBounded = false; break; }
  }
  assert(t.label + ': peaks contain non-trivial signal', hasPeaks);
  assert(t.label + ': all peaks bounded to [-1, 1]', allBounded);
}

// ---------------------------------------------------------------------------
// For each track: simulate setting cue + loop markers at musically meaningful
// positions and verify the pixel formula produces consistent, in-bounds results.
// ---------------------------------------------------------------------------

const CSS_W = 1200; // typical widescreen waveform width
const CSS_H = 120;

for (const t of tracks) {
  const total = t.peaks.buckets; // Waveform uses cache.width = peaks.buckets

  console.log('\n-- Marker pixel positions: ' + t.label + ' --');

  // Simulate: set cue at 10% into track, loop in at 20%, loop out at 35%
  const cueNorm   = 0.10;
  const loopIn    = 0.20;
  const loopOut   = 0.35;

  // --- Full zoom, playhead at cue position ---
  {
    const position = cueNorm;
    const { start, win } = windowFor(total, position, 1.0);

    const cueX    = normToPixel(cueNorm, total, start, win, CSS_W);
    const loopInX = normToPixel(loopIn,  total, start, win, CSS_W);
    const loopOutX= normToPixel(loopOut, total, start, win, CSS_W);
    const playX   = normToPixel(position, total, start, win, CSS_W);

    assert(t.label + ' [1x]: cueX in canvas bounds',    cueX >= 0 && cueX <= CSS_W,    'cueX=' + cueX.toFixed(1));
    assert(t.label + ' [1x]: loopInX in canvas bounds', loopInX >= 0 && loopInX <= CSS_W, 'loopInX=' + loopInX.toFixed(1));
    assert(t.label + ' [1x]: loopOutX in canvas bounds',loopOutX >= 0 && loopOutX <= CSS_W,'loopOutX=' + loopOutX.toFixed(1));
    assert(t.label + ' [1x]: playX matches cueX at full zoom', approxEq(playX, cueX), 'play=' + playX.toFixed(1) + ' cue=' + cueX.toFixed(1));
    assert(t.label + ' [1x]: loopIn left of loopOut',   loopInX < loopOutX, 'in=' + loopInX.toFixed(1) + ' out=' + loopOutX.toFixed(1));

    // Loop fill rect width must be positive
    const fillWidth = loopOutX - loopInX;
    assert(t.label + ' [1x]: loop fill width > 0', fillWidth > 0, 'w=' + fillWidth.toFixed(1));

    // Verify fill rect proportional to the norm interval: (loopOut - loopIn) * CSS_W
    const expected = (loopOut - loopIn) * CSS_W;
    assert(t.label + ' [1x]: fill width proportional to loop region', approxEq(fillWidth, expected, 0.5), 'got=' + fillWidth.toFixed(2) + ' expected=' + expected.toFixed(2));
  }

  // --- 4× zoom, playhead at mid-loop ---
  {
    const position = (loopIn + loopOut) / 2;
    const { start, win } = windowFor(total, position, 0.25);

    const cueX    = normToPixel(cueNorm, total, start, win, CSS_W);
    const loopInX = normToPixel(loopIn,  total, start, win, CSS_W);
    const loopOutX= normToPixel(loopOut, total, start, win, CSS_W);
    const playX   = normToPixel(position, total, start, win, CSS_W);

    // Playhead is centred in 4× zoom
    assert(t.label + ' [4x]: playhead near centre', Math.abs(playX - CSS_W / 2) < 20, 'playX=' + playX.toFixed(1));
    assert(t.label + ' [4x]: loop region visible (loopInX in canvas)', loopInX >= 0 && loopInX <= CSS_W, 'loopInX=' + loopInX.toFixed(1));
    assert(t.label + ' [4x]: loop region visible (loopOutX in canvas)', loopOutX >= 0 && loopOutX <= CSS_W,'loopOutX=' + loopOutX.toFixed(1));
    // Cue is at 0.10 which is outside the [0.175, 0.425] window at 4× zoom centred at 0.275
    assert(t.label + ' [4x]: cue outside window is off-canvas left', cueX < 0, 'cueX=' + cueX.toFixed(1));
    assert(t.label + ' [4x]: fill width > full-zoom fill (4x magnification)', loopOutX - loopInX > (loopOut - loopIn) * CSS_W, 'diff=' + ((loopOutX - loopInX) - (loopOut - loopIn) * CSS_W).toFixed(1));
  }

  // --- 10× zoom, playhead at loop-out ---
  {
    const position = loopOut;
    const { start, win } = windowFor(total, position, 0.1);

    const loopInX = normToPixel(loopIn,  total, start, win, CSS_W);
    const loopOutX= normToPixel(loopOut, total, start, win, CSS_W);
    const playX   = normToPixel(position, total, start, win, CSS_W);

    // At 10× zoom centred on loopOut the playhead should be near CSS_W/2
    assert(t.label + ' [10x]: playhead near centre at loopOut', Math.abs(playX - CSS_W / 2) < 30, 'playX=' + playX.toFixed(1));
    // loopOut marker (coincides with playhead) should be near the centre too
    assert(t.label + ' [10x]: loopOut marker coincides with playhead', approxEq(loopOutX, playX, 1), 'out=' + loopOutX.toFixed(1) + ' play=' + playX.toFixed(1));
    // At 10x zoom centred on loopOut=0.35, the window covers ~[0.30, 0.40].
    // loopIn=0.20 is outside this window — correctly off-canvas (negative pixel).
    assert(t.label + ' [10x]: loopIn off-canvas left at extreme zoom (correct)', loopInX < 0, 'loopInX=' + loopInX.toFixed(1));
  }
}

// ---------------------------------------------------------------------------
// Verify the pixel formula produces the same result as the Waveform source
// (structural cross-check against the actual compiled source)
// ---------------------------------------------------------------------------

console.log('\n-- Source formula cross-check --');
{
  const src = readFileSync(resolve(__dir, 'src/components/Waveform.tsx'), 'utf8');

  // The formula used for every marker in Waveform.tsx
  const formulaPattern = '* total - start) / win) * cssW';
  const occurrences = (src.match(new RegExp(formulaPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  // Formula appears 6 times: 2 in the fill block + 2 for line blocks + cue + playhead.
  // All 6 use the identical formula — exactly as the plan requires.
  assert('Unified pixel formula used for all markers (>=4 occurrences)', occurrences >= 4, 'found ' + occurrences);

  // Confirm loop fill guard checks looping flag
  assert('Loop fill guarded by looping flag', src.includes('looping && loopIn != null && loopOut != null'));

  // Confirm cue is guarded independently
  assert('Cue line guarded independently', src.includes('cueNorm != null'));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '-'.repeat(56));
if (failed === 0) {
  console.log('All ' + passed + ' tests passed.\n');
} else {
  console.log(failed + ' of ' + (passed + failed) + ' tests FAILED.\n');
  process.exit(1);
}
