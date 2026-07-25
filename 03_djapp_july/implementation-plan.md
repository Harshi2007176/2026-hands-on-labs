# Phase 4 Implementation Plan — DeckFlow Web

## High-Level Overview

**Goal:** Add Phase 4 features to the existing Phase 3 app — varispeed tempo control, in-mix cue point, manual loop, and waveform visual markers — without changing any P0–P3 audio behaviour.

**Current state:** The app has a fully working two-deck mixer (P3): file load, play/pause, seek, 3-band EQ, DJ filter, volume, level meter, crossfader, and master volume. The audio graph in `deck.ts` already carries a `tempo` field and multiplies it into `incPerSample`; the UI simply never exposes it yet.

**Approach:** Four self-contained sub-tasks, each touching a clearly bounded slice of the stack. Each can be built, tested, and reviewed independently before the next begins.

```
Sub-task 1 — Tempo       : Add SET_TEMPO action + Knob in DeckControls
Sub-task 2 — Cue point   : Add cueNorm state + SET_CUE action + CUE button + waveform marker
Sub-task 3 — Loop        : Add loopIn/loopOut/looping state + graph wrap + UI buttons
Sub-task 4 — Visual markers : Complete waveform rendering for all markers + loop region shading
```

**Files touched (summary):**

| File | Sub-tasks |
|------|-----------|
| `src/deck.ts` | 1, 2, 3 |
| `src/useDeck.ts` | 1, 2, 3 |
| `src/components/DeckControls.tsx` | 1 |
| `src/components/DeckPanel.tsx` | 2, 3 |
| `src/components/Waveform.tsx` | 2, 3, 4 |
| `src/index.css` | 2, 3, 4 |

**Non-goals for P4:** BPM detection, beat-grid overlay, tap-tempo, SYNC (those are P5). Session library (P6).

---

## Sub-task 1 — Varispeed Tempo Control

### Intent
Expose the `tempo` field that already exists in `DeckState` and already feeds `incPerSample` in `buildDeckSignal()`. The audio graph needs no changes — only the state management and UI need wiring.

### Expected Outcomes
- A TEMPO knob appears in the mixer strip for each deck (alongside EQ/filter in `DeckControls`).
- Dragging the knob changes playback speed continuously from 0.5× to 2.0×.
- Double-clicking resets to 1.0× (standard Knob behaviour via `defaultValue`).
- When a new track loads, `tempo` resets to `1` (already done in the `LOAD` reducer case).

### Todo List
1. Add `SET_TEMPO` to the `Action` union in `useDeck.ts`.
2. Add a `case 'SET_TEMPO'` to the reducer — clamp the value to `[0.5, 2.0]` and return the new state.
3. Add `setTempo: (value: number) => void` to the `UseDeck` interface and implement it with `useCallback`.
4. In `DeckControls.tsx`, add a `<Knob>` below the FILTER knob: `label="TEMPO"`, `min={0.5}`, `max={2.0}`, `defaultValue={1}`, `format` showing `×1.00`.

### Relevant Context
- `DeckState.tempo` — `deck.ts` line 33; already used in `buildDeckSignal()` line 122.
- `initialDeckState()` already sets `tempo: 1` — no change needed there.
- `Knob` props interface: `{ label, value, min, max, defaultValue?, onChange, format? }` — see `src/components/Knob.tsx`.
- Existing EQ knobs in `DeckControls.tsx` lines 21–23 show the exact pattern to follow.
- No changes to `deck.ts` are required for this sub-task.

### Status
[ ] pending

---

## Sub-task 2 — In-Mix Cue Point

### Intent
Let the DJ drop a named position marker ("cue point") into the track while it plays. Pressing CUE while stopped seeks to that point; pressing CUE while playing returns to the cue point and pauses (standard "in-mix cue" behaviour as scoped in the spec — no headphone bus).

### Expected Outcomes
- A CUE button appears in `DeckPanel` beneath the waveform.
- Pressing CUE while playing: pauses and seeks to the stored `cueNorm` (or sets cue to the current position if none stored).
- Pressing CUE while stopped: seeks to `cueNorm` (if stored).
- Long-press / separate "Set Cue" button sets `cueNorm` to the current `position`.
- A vertical marker line appears on the waveform at `cueNorm` (golden/yellow colour, distinct from the red playhead).

### Todo List
1. Add `cueNorm: number | null` to `DeckState` in `deck.ts`; initialise to `null` in `initialDeckState()`.
2. Add `SET_CUE` and `GO_CUE` to the `Action` union in `useDeck.ts`.
   - `SET_CUE` stores the current `position` as `cueNorm`.
   - `GO_CUE` seeks to `cueNorm` (dispatches internally to a SEEK + optional PAUSE).
3. Add reducer cases:
   - `SET_CUE`: `{ ...s, cueNorm: action.norm }`.
   - `GO_CUE`: combine a SEEK to `s.cueNorm` and set `playing: false`.
4. Reset `cueNorm` to `null` in the `LOAD` case so a new track starts clean.
5. Add `setCue: () => void` and `goCue: () => void` to the `UseDeck` interface; implement with `useCallback`.
6. In `DeckPanel.tsx`, add a CUE button row below the waveform:
   - "Set Cue" calls `deck.setCue()` (passing current `deck.position`).
   - "Go Cue" calls `deck.goCue()` (disabled when `cueNorm` is null).
7. Pass `cueNorm={deck.state.cueNorm}` to the `<Waveform>` component (marker rendering is in Sub-task 4, but add the prop now).

### Relevant Context
- `DeckState.baseNorm` + `seekGen` mechanism — `deck.ts` lines 125–128 — is how seeks work; `GO_CUE` re-uses the same `SEEK` action.
- `useDeck.ts` `seek()` helper (line 122) is the pattern for a JS-side seek.
- `DeckPanel.tsx` `.transport` div (line 66) is the insertion point for the CUE button row.
- No changes to the Elementary audio graph are needed.

### Status
[ ] pending

---

## Sub-task 3 — Manual Loop

### Intent
Let the DJ set a loop region (in-point + out-point) and toggle it on/off. While looping is active, the audio graph wraps the transport phase into `[loopIn, loopOut)` using a floored-modulo expression built from Elementary nodes — not a JS check, so the wrap happens at audio rate with no glitch.

### Expected Outcomes
- Three buttons appear in `DeckPanel`: **Loop In** (marks current position as loop start), **Loop Out** (marks current position as loop end and arms the loop), **Loop** (toggles loop on/off).
- While looping: the playhead wraps seamlessly at `loopOut` back to `loopIn`; the `END` action is never triggered.
- Toggling loop off: playback continues from the current wrapped position (loop-exit re-bases the transport — see spec §6).
- Loop region is visible on the waveform as a shaded area + in/out lines (Sub-task 4 handles rendering; this sub-task adds the props).

### Todo List
1. Add `loopIn: number | null`, `loopOut: number | null`, `looping: boolean` to `DeckState` in `deck.ts`; initialise to `null`, `null`, `false` in `initialDeckState()`.
2. Add `SET_LOOP_IN`, `SET_LOOP_OUT`, `TOGGLE_LOOP` to the `Action` union in `useDeck.ts`.
3. Add reducer cases:
   - `SET_LOOP_IN`: stores current position; if `loopOut` already set and `loopIn >= loopOut`, reset `loopOut` to null.
   - `SET_LOOP_OUT`: stores current position; arms the loop (`looping: true`) if both points are valid.
   - `TOGGLE_LOOP`: flips `looping`; when turning loop **off**, also bumps `seekGen` and updates `baseNorm` to current `position` so the accumulator re-bases (loop-exit re-base per spec §6).
4. Reset `loopIn`, `loopOut`, `looping` to defaults in the `LOAD` case.
5. Add `setLoopIn()`, `setLoopOut()`, `toggleLoop()` to `UseDeck` interface; implement with `useCallback`.
6. In `buildDeckSignal()` in `deck.ts`, conditionally wrap the `position` signal:
   - If `s.looping && s.loopIn !== null && s.loopOut !== null`:
     - Compute `len = loopOut - loopIn` as an `el.const`.
     - Wrap: `wrapped = loopIn + (position - loopIn) - len * el.floor(el.div(el.sub(position, loopIn), len))`.
     - Use the `wrapped` signal for `el.table` reads (instead of raw `position`).
   - Otherwise use `position` unchanged.
7. In `DeckPanel.tsx`, add a `.loop-controls` button row: **Loop In**, **Loop Out**, **Loop** (toggle, highlighted when `looping === true`).
8. Pass `loopIn`, `loopOut`, `looping` as props to `<Waveform>` (rendering in Sub-task 4).

### Relevant Context
- Spec §6 "The deck audio model" — floored-modulo description and loop-exit re-base requirement.
- `buildDeckSignal()` position construction — `deck.ts` lines 122–128 — is where the wrap inserts.
- The wrapped position only feeds `el.table`; the `posTap` snapshot still reads `position` (raw, not `wrapped`) so the playhead display reflects the true accumulated value during loop (this is fine — playhead will appear to snap back).
- `el.floor`, `el.div`, `el.sub`, `el.mul` are all available from `@elemaudio/core`.
- Because the graph structure changes when `looping` flips, Elementary will diff and rewire the affected nodes; unchanged downstream nodes (EQ, filter, meter) keep their state — no audible glitch.

### Status
[x] complete

---

## Sub-task 4 — Visual Markers on the Waveform

### Intent
Render all Phase 4 markers onto the waveform canvas: a cue-point line, loop-in and loop-out lines, and a translucent loop-region fill. All drawing uses the same pixel-from-norm formula already used for the playhead, so zoom and scroll work automatically.

### Expected Outcomes
- **Cue marker**: a vertical golden/amber line at `cueNorm`, visible at all zoom levels.
- **Loop in/out markers**: two green vertical lines at `loopIn` / `loopOut`.
- **Loop region fill**: a translucent green rectangle between `loopIn` and `loopOut` when `looping === true`.
- All markers scroll correctly with zoom (they share the same `{ start, win }` window as the playhead).
- Markers outside the current zoom window are simply not drawn (clipping handles this naturally).
- No new canvas layers — everything drawn in the existing `draw()` callback, ordered: peaks → loop fill → loop lines → cue line → playhead (so playhead is always on top).

### Todo List
1. Extend the `Props` interface in `Waveform.tsx`:
   - Add `cueNorm?: number | null`
   - Add `loopIn?: number | null`
   - Add `loopOut?: number | null`
   - Add `looping?: boolean`
2. Add all four new props to the `useCallback` dependency array of `draw()`.
3. Inside `draw()`, after the waveform blit (`ctx.drawImage`) and before the playhead line, add canvas drawing for:
   - **Loop region fill** (only if `looping && loopIn != null && loopOut != null`): `ctx.fillStyle = 'rgba(76,194,255,0.15)'`, filled rect between loopInX and loopOutX.
   - **Loop in line** (if `loopIn != null`): green `#4caf50`, 2px, full height.
   - **Loop out line** (if `loopOut != null`): green `#4caf50`, 2px, full height.
   - **Cue line** (if `cueNorm != null`): amber `#ffb700`, 2px, full height.
   - Playhead last (already exists, no change).
4. Use the same norm-to-pixel formula as the existing playhead: `markerX = ((norm * total - start) / win) * cssW`.
5. In `DeckPanel.tsx`, pass the four new props to `<Waveform>`:
   ```
   cueNorm={deck.state.cueNorm}
   loopIn={deck.state.loopIn}
   loopOut={deck.state.loopOut}
   looping={deck.state.looping}
   ```
6. Add any needed CSS for the new button states (`.btn.active` highlight for the active Loop toggle button) to `index.css`.

### Relevant Context
- `Waveform.tsx` `draw()` — lines 82–126; the pixel formula is on line 119.
- `windowFor()` — lines 72–80 — returns `{ start, win }` used for all position-to-pixel conversions; markers must use the same values.
- Existing playhead is drawn at lines 119–125; new markers insert **before** line 119 so the playhead stays on top.
- CSS variable `--accent: #4cc2ff` is the app's primary cyan; use `rgba(76,194,255,0.15)` for the loop fill (matches but is translucent).
- Existing `.btn` and `.btn.ghost` classes in `index.css` are the base; add `.btn.active` for the lit-up Loop toggle.

### Status
[x] complete
