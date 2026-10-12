const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const S = 9;                 // 每个像素放大倍数
const ORANGE = '#D97757', DARK = '#B85C3E', BLACK = '#1a1a1a';
const OX = Math.round((220 - 15 * S) / 2), BASE = 200 - 6; // 脚底线

let state = 'idle';          // idle | walk | sleep | happy | drag
let t = 0, dir = 1, blinkAt = 120, blinkLeft = 0, happyLeft = 0, stateLeft = 0;
let autoWalk = true;

const px = (x, y, w, h, c, dy = 0) => {
  ctx.fillStyle = c;
  ctx.fillRect(OX + x * S, BASE - (8 - y) * S - dy * S, w * S, h * S);
};

function draw() {
  ctx.clearRect(0, 0, 220, 200);
  const hop = state === 'happy' ? Math.abs(Math.sin(t / 5)) * 4 : 0;
  const bob = state === 'idle' ? Math.round(Math.sin(t / 25) * 0.6 + 0.6) * 0 : 0;
  const lift = hop + (state === 'drag' ? 2 : 0);
  const squash = state === 'sleep' ? 0 : 0;

  // 影子
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(110, BASE + 3, 52 - lift * 3, 5, 0, 0, 7); ctx.fill();

  const step = state === 'walk' ? Math.floor(t / 6) % 2 : 0;
  // 腿 (4 条, 走路时交替)
  [3, 5, 9, 11].forEach((x, i) => {
    const up = state === 'walk' && (i + step) % 2 === 0 ? 1 : 0;
    px(x, 6, 1, 2 - up, DARK, lift + up);
  });
  // 身体
  px(2, 0 + squash, 11, 6, ORANGE, lift);
  // 手臂 (开心/走路时摆动)
  const wave = state === 'happy' ? (Math.floor(t / 5) % 2) * 2 : state === 'walk' ? step : 0;
  px(0, 2 - wave, 2, 2, ORANGE, lift);
  px(13, 2 - (state === 'happy' ? 2 - wave : 0), 2, 2, ORANGE, lift);
  // 眼睛
  const closed = state === 'sleep' || blinkLeft > 0;
  if (state === 'happy') {            // ^ ^
    [4, 10].forEach(x => { px(x, 2, 1, 1, BLACK, lift); px(x - 1 + 0, 3, 1, 1, BLACK, lift); px(x + 1, 3, 1, 1, BLACK, lift); });
  } else if (closed) {
    [4, 10].forEach(x => px(x, 3, 1, 1, BLACK, lift));
  } else {
    const look = state === 'walk' ? dir : 0;
    [4, 10].forEach(x => px(x, 2, 1, 2, BLACK, lift));
    if (look) { ctx.fillStyle = ORANGE; }
  }
  // zzz
  if (state === 'sleep') {
    ctx.fillStyle = '#888'; ctx.font = 'bold 18px monospace';
    const k = Math.floor(t / 30) % 3;
    ctx.fillText('z', 150, 70 - k * 4); if (k > 0) ctx.fillText('Z', 165, 50 - k * 4);
  }
  if (state === 'happy') { ctx.fillStyle = '#e25563'; ctx.font = '20px sans-serif'; ctx.fillText('♥', 150, 60 - (t % 40) / 2); }
}

function setState(s, frames = 0) { state = s; stateLeft = frames; t = 0; }

function think() { // 随机行为
  if (state === 'sleep' || state === 'drag' || state === 'happy') return;
  const r = Math.random();
  if (state === 'walk') setState('idle', 60 + Math.random() * 120);
  else if (autoWalk && r < 0.55) { dir = Math.random() < 0.5 ? -1 : 1; setState('walk', 120 + Math.random() * 240); }
  else if (r > 0.92) setState('sleep', 400 + Math.random() * 400);
  else setState('idle', 90 + Math.random() * 200);
}

let pos = null, lastBounds = null;
async function refreshBounds() { lastBounds = await pet.getBounds(); pos = { x: lastBounds.x, y: lastBounds.y }; }

function tick() {
  t++;
  if (--blinkAt <= 0) { blinkLeft = 8; blinkAt = 100 + Math.random() * 220; }
  if (blinkLeft > 0) blinkLeft--;
  if (state !== 'drag' && state !== 'happy' && --stateLeft <= 0) think();
  if (state === 'happy' && --stateLeft <= 0) setState('idle', 100);
  if (state === 'walk' && pos && lastBounds) {
    const w = lastBounds.work;
    pos.x += dir * 1.5;
    if (pos.x < w.x) { pos.x = w.x; dir = 1; }
    if (pos.x > w.x + w.width - lastBounds.width) { pos.x = w.x + w.width - lastBounds.width; dir = -1; }
    pet.setPos(pos.x, pos.y);
  }
  draw();
  requestAnimationFrame(tick);
}

// 拖拽 / 点击
let drag = null;
cv.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  drag = { sx: e.screenX, sy: e.screenY, x: pos.x, y: pos.y, moved: false, prev: state };
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) { drag.moved = true; setState('drag'); cv.classList.add('drag'); }
  pos.x = drag.x + dx; pos.y = drag.y + dy; pet.setPos(pos.x, pos.y);
});
window.addEventListener('mouseup', async () => {
  if (!drag) return;
  const was = drag; drag = null; cv.classList.remove('drag');
  if (was.moved) { await refreshBounds(); setState('idle', 60); }
  else setState('happy', 90);   // 单击 = 开心 (睡着时被戳醒)
});
cv.addEventListener('contextmenu', e => { e.preventDefault(); pet.menu(); });
pet.onCommand(c => {
  if (c === 'happy') setState('happy', 90);
  if (c === 'toggle-sleep') state === 'sleep' ? setState('idle', 60) : setState('sleep', 1e9);
  if (c === 'toggle-walk') { autoWalk = !autoWalk; if (!autoWalk && state === 'walk') setState('idle', 60); }
});

refreshBounds().then(() => { setState('idle', 60); tick(); });
