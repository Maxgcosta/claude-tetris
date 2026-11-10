'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#f06292', // H - pink (3x3 hueca)
  '#ffd700', // P - dorado (power-up 1x1)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // H - 3x3 hueca (reto)
  [[9]],                                       // P - power-up 1x1 (no se fusiona al tablero)
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const SPECIAL_CHANCE = 0.05;

const POWERUP_EVERY = 10; // líneas entre power-ups
const FREEZE_MS = 5000;
const POWERUPS = {
  bomb:    { icon: '💣', name: 'Bomba' },
  ray:     { icon: '⚡', name: 'Rayo' },
  tint:    { icon: '🎨', name: 'Tinte' },
  gravity: { icon: '⬇️', name: 'Gravedad' },
  freeze:  { icon: '❄️', name: 'Congelar' },
};

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const powerupEl = document.getElementById('powerup');
const skinSelect = document.getElementById('skin-select');
let gridColor = '#e3e5ee';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pendingPowerup, freezeMs, lastPowerup;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.random() < SPECIAL_CHANCE ? 8 : Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPowerup() {
  const keys = Object.keys(POWERUPS);
  const power = keys[Math.floor(Math.random() * keys.length)];
  return { type: 9, power, shape: [[9]], x: Math.floor(COLS / 2), y: 0 };
}

function applyPowerup({ power, x, y }) {
  switch (power) {
    case 'bomb':
      for (let r = y - 1; r <= y + 1; r++)
        for (let c = x - 1; c <= x + 1; c++)
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS) board[r][c] = 0;
      break;
    case 'ray':
      board[y].fill(0);
      for (let r = 0; r < ROWS; r++) board[r][x] = 0;
      break;
    case 'tint': {
      let color = y + 1 < ROWS ? board[y + 1][x] : 0;
      if (!color) {
        const counts = {};
        for (const row of board) for (const v of row) if (v) counts[v] = (counts[v] || 0) + 1;
        color = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 0;
      }
      if (color)
        for (const row of board)
          for (let c = 0; c < COLS; c++) if (row[c] === color) row[c] = 0;
      break;
    }
    case 'gravity':
      for (let c = 0; c < COLS; c++) {
        const col = [];
        for (let r = 0; r < ROWS; r++) if (board[r][c]) col.push(board[r][c]);
        for (let r = ROWS - 1; r >= 0; r--) board[r][c] = col.pop() || 0;
      }
      break;
    case 'freeze':
      freezeMs = FREEZE_MS;
      break;
  }
  lastPowerup = POWERUPS[power].name;
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    const before = Math.floor(lines / POWERUP_EVERY);
    lines += cleared;
    if (Math.floor(lines / POWERUP_EVERY) > before) pendingPowerup = true;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.power) applyPowerup(current);
  else merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = pendingPowerup ? randomPowerup() : randomPiece();
  pendingPowerup = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  powerupEl.textContent = freezeMs > 0
    ? `❄️ ${Math.ceil(freezeMs / 1000)}s`
    : (lastPowerup || '—');
}

function roundedRectPath(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

// Cada skin define su paleta (índices 1–9 como COLORS) y su función de dibujo de bloque.
const SKINS = {
  retro: {
    name: 'Retro',
    colors: COLORS,
    draw(context, px, py, size, color) {
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      context.fillStyle = 'rgba(255,255,255,0.12)';
      context.fillRect(px + 1, py + 1, size - 2, 4);
    },
  },
  neon: {
    name: 'Neon',
    colors: [
      null,
      '#00f0ff', '#fff700', '#d500f9', '#39ff14',
      '#ff1744', '#2979ff', '#ff9100', '#ff2bd6', '#ffffff',
    ],
    draw(context, px, py, size, color) {
      context.shadowColor = color;
      context.shadowBlur = size * 0.5;
      context.fillStyle = color;
      const prevAlpha = context.globalAlpha;
      context.globalAlpha = prevAlpha * 0.35;
      context.fillRect(px + 2, py + 2, size - 4, size - 4);
      context.globalAlpha = prevAlpha;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px + 2, py + 2, size - 4, size - 4);
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
    },
  },
  pastel: {
    name: 'Pastel',
    colors: [
      null,
      '#a8e6ef', '#fff1a8', '#d9b8f0', '#b8e8c0',
      '#f7b8b8', '#b8d4f7', '#ffd6a5', '#f9b8d2', '#ffe08a',
    ],
    draw(context, px, py, size, color) {
      const r = size * 0.28;
      context.fillStyle = color;
      roundedRectPath(context, px + 1.5, py + 1.5, size - 3, size - 3, r);
      context.fill();
      context.fillStyle = 'rgba(255,255,255,0.45)';
      roundedRectPath(context, px + 5, py + 4, size - 10, size * 0.2, size * 0.1);
      context.fill();
    },
  },
  pixel: {
    name: 'Pixel art',
    colors: [
      null,
      '#00bcd4', '#fbc02d', '#8e24aa', '#43a047',
      '#e53935', '#1e88e5', '#fb8c00', '#d81b60', '#ffc107',
    ],
    draw(context, px, py, size, color) {
      const u = Math.max(2, Math.round(size / 10)); // "píxel" de la textura
      context.fillStyle = color;
      context.fillRect(px, py, size, size);
      // borde oscuro
      context.fillStyle = 'rgba(0,0,0,0.55)';
      context.fillRect(px, py, size, u);
      context.fillRect(px, py + size - u, size, u);
      context.fillRect(px, py, u, size);
      context.fillRect(px + size - u, py, u, size);
      // textura de damero (claro/oscuro) en el interior
      const inner = Math.floor((size - 2 * u) / u);
      for (let i = 0; i < inner; i++) {
        for (let j = 0; j < inner; j++) {
          if ((i + j) % 2) continue;
          context.fillStyle = (i < inner / 2 && j < inner / 2)
            ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)';
          context.fillRect(px + u + j * u, py + u + i * u, u, u);
        }
      }
    },
  },
};
const SKIN_ORDER = ['retro', 'neon', 'pastel', 'pixel'];
let skin = 'retro';

function drawBlock(context, x, y, colorIndex, size, alpha, icon) {
  if (!colorIndex) return;
  const color = SKINS[skin].colors[colorIndex];
  context.globalAlpha = alpha ?? 1;
  SKINS[skin].draw(context, x * size, y * size, size, color);
  if (icon) {
    context.font = `${Math.floor(size * 0.6)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#000';
    context.fillText(icon, x * size + size / 2, y * size + size / 2 + 1);
  }
  context.globalAlpha = 1;
}

function pieceIcon(piece) {
  return piece.power ? POWERUPS[piece.power].icon : undefined;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2, pieceIcon(current));

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK, undefined, pieceIcon(current));
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB, undefined, pieceIcon(next));
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (freezeMs > 0) {
    freezeMs = Math.max(0, freezeMs - dt);
    updateHUD();
  } else {
    dropAccum += dt;
  }
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (!gameOver) animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  pendingPowerup = false;
  freezeMs = 0;
  lastPowerup = null;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  themeToggle.textContent = theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro';
  if (current) { draw(); drawNext(); }
}

themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', theme); } catch (e) {}
  applyTheme(theme);
  themeToggle.blur(); // evita que Space reactive el botón
});

function applySkin(name) {
  if (!SKINS[name]) name = 'retro';
  skin = name;
  document.documentElement.dataset.skin = name;
  skinSelect.value = name;
  // solo Retro usa el tema claro/oscuro; las demás skins definen su propia paleta
  themeToggle.disabled = name !== 'retro';
  themeToggle.title = themeToggle.disabled ? 'Solo disponible con la skin Retro' : '';
  // los colores CSS (--grid, fondo) dependen de la skin
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  if (current) { draw(); drawNext(); }
}

for (const key of SKIN_ORDER) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = SKINS[key].name;
  skinSelect.appendChild(opt);
}

skinSelect.addEventListener('change', () => {
  try { localStorage.setItem('skin', skinSelect.value); } catch (e) {}
  applySkin(skinSelect.value);
  skinSelect.blur(); // evita que las flechas/Space cambien la skin
});

let savedTheme = 'light';
try { savedTheme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch (e) {}
applyTheme(savedTheme);

let savedSkin = 'retro';
try { savedSkin = localStorage.getItem('skin') || 'retro'; } catch (e) {}
applySkin(savedSkin);

init();
