# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tetris in vanilla JavaScript + HTML5 Canvas. No dependencies, no build step, no package.json, no tests, no linter. The README and UI text are in Spanish; keep user-facing strings in Spanish.

## Running

Open `index.html` directly, or serve the folder (e.g. `python3 -m http.server 8000`) and visit `http://localhost:8000`.

## Architecture

Three files, all loaded by `index.html` (`game.js` is a classic script, not a module — everything is global):

- `index.html` — fixed DOM: `#board` canvas (300×600 = 10×20 cells at `BLOCK = 30`), `#next-canvas` (120×120), HUD spans (`#score`, `#lines`, `#level`), and `#overlay` (shared by pause and game over; toggled via the `hidden` class).
- `style.css` — layout/theme only.
- `game.js` — all game logic, using module-level mutable state (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, ...) that `init()` resets.

### Game flow in `game.js`

- `init()` resets state and starts the `requestAnimationFrame` loop; the restart button calls it again.
- `loop(ts)` accumulates elapsed time into `dropAccum` and applies gravity when it exceeds `dropInterval`, then calls `draw()`. Pause/game over stop it via `cancelAnimationFrame(animId)`.
- Pieces are 2D arrays of color indices into `COLORS`/`PIECES` (index 0 = empty, 1–7 = I,O,T,S,Z,J,L); the same index is stored in `board` when merged, so adding a piece means adding to both arrays and changing the `* 7` in `randomPiece()`.
- Locking path: `lockPiece()` → `merge()` → `clearLines()` (updates score/lines/level/`dropInterval`) → `spawn()` (promotes `next`, ends the game if the new piece collides).
- Rotation is clockwise-only with simple horizontal wall kicks (`[0,-1,1,-2,2]`), no SRS.
- Scoring: `LINE_SCORES[cleared] * level`, plus 1/cell for soft drop and 2/cell for hard drop. Level = `floor(lines/10)+1`; `dropInterval = max(100, 1000 - (level-1)*90)` ms.
- Theming: colors live in CSS variables (`:root` = light default, `[data-theme="dark"]` overrides). `applyTheme()` sets `document.documentElement.dataset.theme`, reads `--grid` into `gridColor` for `drawGrid()`, and redraws; the choice persists in `localStorage` (`theme`). Add new colors as variables, not hex literals.
- Input is a single `keydown` listener (arrows, `X` rotate, `Space` hard drop, `P` pause).
