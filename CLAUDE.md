# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A dependency-free web app (PWA, no build step) that emulates a Heathkit H8
digital computer (1977), its H9 video terminal, and the H8-5 serial/cassette interface card —
running the **original ROM firmware** (PAM-8 monitor) on a hand-written 8080A emulator, not a
reimplementation of its behavior. There is no build system, no package.json, no npm dependencies —
plain `index.html` + `css/app.css` + native ES modules under `js/`, plus `manifest.webmanifest`,
`sw.js` (service worker) and `icons/` for installability/offline use. Until the restructuring
(see git history) everything lived in a single `H8-H9-Simulator.html`.

The PDFs in `docs/manuals/` (`AS+H8...`, `OP+H8...`, `SC+H8...`) are the original Heathkit assembly/
operation/schematic manuals for the H8 — treat them as authoritative sources when changing anything
about H8 behavior, and check them before guessing at hardware/firmware behavior.

## Commands

There is no build, lint, or test tooling. Development loop:

- **Run it**: serve the repo root over HTTP and open it, e.g. `python3 -m http.server 8000` →
  <http://localhost:8000>. Opening `index.html` via `file://` does **not** work: browsers refuse to
  load ES modules from `file://`, and service workers need http(s) (localhost counts).
- **Syntax-check** after editing (no linter exists):
  `for f in js/*.js js/data/*.js sw.js; do node --check $f; done` (Node >= 20.19 detects ES-module
  syntax in `.js` files on its own; there is deliberately no package.json).
- **No automated test suite exists**, but the core modules (`cpu.js`, `h8.js`, `h9.js`, `cassette.js`,
  `programs.js`, `wire.js`, `audio.js`, `data/*`) touch no DOM at import time and can be imported
  directly in Node for headless tests — e.g. `await import("./js/programs.js")`, call
  `romLoadExtendedBasic()`, then read `h9.buf` to see the BASIC banner. Only `panel.js` and
  `main.js` need a DOM. In the browser console, `window.__h8dbg` exposes `rom`, `wire`, `h9`,
  `cassette` & co.
- **Service worker / caching**: `sw.js` is network-first, so during development a normal reload
  always gets fresh files (no cache-version bump needed). **When adding a new file to the app, add it
  to `APP_FILES` in `sw.js`**, otherwise it is not available offline until visited once online.

### Testing gotchas (read before spending time debugging "broken" behavior)

- **`romRunLoop`/`h9RunLoop` are driven by `setTimeout`, not `requestAnimationFrame`.** This was a
  deliberate fix (see git history): rAF callbacks are fully suspended by Chrome for hidden/unfocused
  tabs (not just throttled), which used to freeze the *entire* emulator — including an in-progress
  cassette LOAD/DUMP — the moment a tab lost focus, with zero feedback to the user. `setTimeout` is
  only throttled (clamped to ~1/s) in hidden tabs, so background-tab automation is slower but no
  longer hangs indefinitely; no rAF patch is needed before testing. Don't revert this to rAF without
  re-introducing that freeze.
- For Node-side testing, power on via the exported `powerOn()` from `js/h8.js` (the internal
  `romPowerOn()` alone does not set the module-level `powered` flag that `romPressKey` checks, so key
  presses would silently no-op). `powered`/`h9powered` are exported `let` bindings — read-only for
  importers, changed only via `powerOn`/`powerOff`/`togglePower`/`h9TogglePower`.
- The panel ROM's keyboard scan has real debounce timing. A single `romPressKey`/`romReleaseKey` pair
  needs a few thousand emulated CPU steps of hold and gap to register reliably in a synchronous test
  loop (see `romPressAndRelease` for the real timer-based version used in the UI, ~60ms hold/50ms gap).
  Too few steps between press/release silently drops keystrokes.
- Sampling `rom.cpu.pc` from outside the frame loop is misleading: the frame budget (6000 CPU steps)
  is an exact multiple of the periodic interrupt period (400 steps), so an external PC snapshot taken
  between frames very often lands exactly on the interrupt vector (`010` octal) regardless of what's
  actually executing. This is why the lamp logic (`ionSeen`/`userSeen`) ORs a flag across the whole
  frame instead of trusting a single end-of-frame snapshot — do the same in any new diagnostics.
- After a fresh `powerOn()`, PAM8 runs a RAM-size boot/test routine before it reaches the idle key-scan
  loop. Typed input sent too early (e.g. via the automated demo-loading buttons) is silently ignored.
  Existing code already accounts for this (`await delay(800)` after a cold `powerOn()`); don't remove it.

## Architecture

Native ES modules (strict mode implicitly), one concern per file, loaded via
`<script type="module" src="js/main.js">`. Reading order that matches the dependency structure:

- Core, no DOM access: `js/cpu.js` → `js/data/*` → `js/audio.js`, `js/wire.js`, `js/cassette.js` →
  `js/h8.js` → `js/h9.js` → `js/programs.js`
- DOM layer: `js/panel.js` (H8 front panel) and `js/main.js` (everything else on the page, SW registration)

Core modules report to the UI only through hook fields, following the existing `cpu.onIn`/`cpu.onOut`
pattern: `rom.onRender`/`rom.onPowerChange` (set by `panel.js`), `cassette.onChange` and
`h9AttachCanvas()` (set by `main.js`). Keep new core code free of `document` so it stays Node-testable.


1. **8080A CPU emulator** (`js/cpu.js`, `CPU` function + `CPU.prototype.*`) — a from-scratch 8080 instruction
   interpreter (no Z80 extensions; those existed for an H19 terminal emulation that was deliberately
   removed, see git history). `cpu.onIn`/`cpu.onOut` are pluggable hooks other subsystems wire up.
2. **PAM8 ROM emulation** (`js/h8.js`: `rom` object, `powerOn`/`romIoIn`/`romIoOut`/`romRunLoop`; the
   display side `romRender` lives in `js/panel.js`) — loads the actual PAM-8 monitor ROM
   (`js/data/pam8-rom.js`, byte-identical to MAME's `2708_444-13_pam8.rom`, SHA-256 in the file header) into a `CPU` instance
   and drives it at 6000 steps/frame with a periodic interrupt every 400 steps. `ROM_KEY_BYTE` and
   `ROM_SEG` are the empirically-reverse-engineered keyboard matrix and 7-segment decode tables (see
   comments citing `XCON8 ROM.asm`, the T. Gulczynski PAM-8 re-creation, as the cross-reference).
3. **H9 terminal emulation** (`js/h9.js`: `h9` object + `h9*` functions) — a from-scratch behavioral model (NOT a
   firmware emulator: the real H9 is pure TTL/MSI logic, no CPU/ROM exists to run) built directly from
   the original Heathkit H9 Operation manual (595-2017-03). Key facts baked in from that manual, don't
   re-derive them: 12×80 character grid, only BS/BEL/LF/CR have any effect on the display (all other
   control codes incl. ESC are silently dropped, from BOTH keyboard and the wire), arrow/HOME/erase
   keys are purely local and never transmit, and FULL DUPLEX/AUTO CARRY/SCROLL are real toggles whose
   *un-pressed* state is the documented default (half-duplex local echo, no line wrap, no auto-scroll
   → HOLD SCREEN when the page fills).
4. **Serial link glue** (`js/wire.js`: `wire` object `{toH8:[], toH9:[]}`; the console USART itself is in `js/h8.js`) — the two byte queues connecting the H8's
   emulated console USART to the H9. Port addresses (372/373 octal = `0xFA`/`0xFB`) are the *real*
   Heathkit H8-5 "Serial I/O and Cassette Interface Card" console-USART assignment (manual 595-2032-03,
   §"Port Select": the card's standard jumpering used by Heath's own software), not invented. The 8251's
   mode/command bytes, RxRDY/TxRDY/TxE status bits and the RST 3 receive interrupt (when DTR is set)
   are modeled; there is no real UART timing, baud rate, or error detection.
5. **Virtual cassette** (`js/cassette.js`: `cassette` object `{data:[], pos:0}`; port handling in `js/h8.js`, ports `0xF8`/`0xF9` = 370/371 octal) —
   same H8-5 card, second USART, same simplified status-bit handshake as the console link. Critically,
   **LOAD and DUMP are the real, unmodified PAM-8 ROM routines** (sync-byte search, STX, header, CRC-16
   — all computed/verified by the actual ROM, cross-referenced against the official PAM-8 source listing
   Heath 595-2348). This emulation only supplies the byte transport (a JS array standing in for tape);
   it does not reimplement the tape format or checksum algorithm anywhere.
6. **Typed programs** (`js/programs.js`: `romLoadExample`, `romLoadInitialTestRoutine`, the serial-echo
   demo `SERIAL_ECHO_DEMO`/`romLoadSerialEcho`, and the Extended BASIC direct start `romLoadExtendedBasic`,
   whose tape image is `js/data/extended-basic-tape.js`). For the echo demo —
   since PAM8 itself has no serial routines, a tiny hand-assembled 8080 program (visible as an octal
   byte array) is typed into H8 RAM via real, timed keystrokes and started with GO, purely so the H9
   demo has something to talk to. This is *not* original Heath code — it's clearly commented as such.
7. **UI wiring** — `js/panel.js`: 7-segment/lamp rendering (`SEGMENTS`, `romRender`), keypad and keyboard
   shortcuts, H8 power switch. `js/main.js`: card buttons (with `runBusy` disabling a button while its
   timed keystroke chain runs), H9 switches and screen keyboard, cassette file load/save, service worker.
8. **PWA shell** — `manifest.webmanifest`, `sw.js` (network-first, precaches `APP_FILES`), `icons/`
   (`icon.svg` is the source; the PNGs were rendered from it with macOS `qlmanage` + `sips`).

### Conventions specific to this codebase

- **Front-panel address entry is not a single octal number.** Typing 6 digits in MEM/REG mode is
  parsed as *two separate* 3-digit octal bytes (hi, then lo), combined as `hi*256+lo` — not as one
  continuous 6-digit octal value. This was verified empirically (marker-byte write test) and is used
  throughout (`romLoadExample`, `romLoadSerialEcho`, the DUMP/LOAD test harness). E.g. typing
  `040300` sets the address to `0x20C0`, *not* `0o040300`.
- Octal is used pervasively in comments and literals (`0o333`, `0xDB`) because the H8/PAM-8 world is
  octal-native (front panel displays, port numbers, manual page references) — keep new code consistent
  with whichever the surrounding routine already uses rather than converting everything to hex.
- Every non-obvious behavioral choice (port numbers, timing constants, keyboard matrix, tape format)
  is expected to carry a comment citing *where it came from* (a manual + page/section, a ROM listing
  page, or "empirically determined via X") — the code has no other documentation, so an undocumented
  magic number here is a future landmine. Follow that pattern for new hardware-accuracy work.
- Where real hardware behavior isn't fully known or isn't modeled (e.g. H9's SHORT FORM/PLOT modes,
  baud-rate selection, USART mode/command bytes, tape FSK/timing), the code and the on-page
  documentation say so explicitly rather than silently approximating — keep that honesty when adding
  features; don't quietly fake authenticity.
- Commit messages in this repo are German, imperative/descriptive, prefixed `Feature:`/`Fix:` for
  substantive changes (see `git log`).
