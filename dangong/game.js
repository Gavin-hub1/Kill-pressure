const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const comboValue = document.getElementById("comboValue");
const modeValue = document.getElementById("modeValue");
const worryForm = document.getElementById("worryForm");
const worryInput = document.getElementById("worryInput");
const worryList = document.getElementById("worryList");
const resetButton = document.getElementById("resetButton");
const diaryButton = document.getElementById("diaryButton");
const diaryDrawer = document.getElementById("diaryDrawer");
const closeDiary = document.getElementById("closeDiary");
const diaryEntries = document.getElementById("diaryEntries");
const reflectionPrompt = document.getElementById("reflectionPrompt");
const encourageText = document.getElementById("encourageText");
const reflectionInput = document.getElementById("reflectionInput");
const saveReflection = document.getElementById("saveReflection");
const skipReflection = document.getElementById("skipReflection");
const accountButton = document.getElementById("accountButton");
const accountLabel = document.getElementById("accountLabel");
const accountModal = document.getElementById("accountModal");
const accountForm = document.getElementById("accountForm");
const accountTitle = document.getElementById("accountTitle");
const accountHint = document.getElementById("accountHint");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const accountMessage = document.getElementById("accountMessage");
const closeAccount = document.getElementById("closeAccount");
const submitAccount = document.getElementById("submitAccount");
const toggleAccountMode = document.getElementById("toggleAccountMode");
const logoutButton = document.getElementById("logoutButton");

const STORAGE_KEY = "slingshot-worries-v1";
const DIARY_KEY = "slingshot-diary-v1";
const SESSION_KEY = "slingshot-session-v1";
const DEFAULT_WORRIES = ["工作焦虑", "学习压力", "金钱压力", "孤独", "年龄焦虑", "情感困惑", "迷茫"];
const TAUNTS = ["打不中吧略略略", "再来一次呀", "风都看笑了", "差一点点喔"];
const SCREAMS = ["啊！", "可恶！", "你等着！", "我裂开了！"];
const FINAL_ENCOURAGEMENT = "精准度太棒了！让烦恼都烟消云散！";
const COLORS = ["#ffcc4d", "#ff6b6b", "#62d2a2", "#6c8cff", "#f875aa", "#ffd166"];

let width = 0;
let height = 0;
let dpr = 1;
let lastTime = performance.now();
let accumulator = 0;
const step = 1000 / 60;

const state = {
  worries: loadWorries(),
  clouds: [],
  particles: [],
  floatTexts: [],
  projectile: null,
  dragging: false,
  pointerId: null,
  dragPoint: null,
  dragStartTime: 0,
  combo: 0,
  upgraded: false,
  comboPulse: 0,
  missCooldown: 0,
  diary: loadDiary(),
  account: loadSession(),
  authMode: "login",
  pendingReflection: null,
  defeatedToday: [],
  audio: null,
};

function loadWorries() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) {
      return saved.map(String).filter(Boolean).slice(0, 12);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return [...DEFAULT_WORRIES];
}

function saveWorries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.worries));
  renderWorryList();
}

function loadDiary() {
  try {
    const saved = JSON.parse(localStorage.getItem(DIARY_KEY) || "[]");
    if (Array.isArray(saved)) {
      const byDate = new Map();
      saved.forEach((item) => {
        if (!item || !item.date) return;
        if (Array.isArray(item.worries)) {
          byDate.set(item.date, {
            id: item.id || makeId(),
            date: item.date,
            time: item.time || "",
            worries: item.worries.map(String).filter(Boolean),
            reflection: item.reflection || "这一天没有写下感想，但烦恼已经被击败。",
          });
          return;
        }
        if (item.worry) {
          const current = byDate.get(item.date) || {
            id: makeId(),
            date: item.date,
            time: item.time || "",
            worries: [],
            reflection: item.reflection || "",
          };
          current.worries.push(item.worry);
          if (item.reflection && !current.reflection) current.reflection = item.reflection;
          byDate.set(item.date, current);
        }
      });
      return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    }
  } catch {
    localStorage.removeItem(DIARY_KEY);
  }
  return [];
}

function saveDiary() {
  localStorage.setItem(DIARY_KEY, JSON.stringify(state.diary));
  syncDiary();
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (saved && saved.token && saved.username) return saved;
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
  return null;
}

function saveSession(account) {
  state.account = account;
  if (account) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(account));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
  updateAccountHud();
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.account?.token) headers.Authorization = `Bearer ${state.account.token}`;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("连接不到账户服务。请先运行 node server.js，并通过 http://127.0.0.1:4173 打开游戏。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function syncDiary() {
  if (!state.account?.token) return;
  try {
    await api("/api/diary", {
      method: "PUT",
      body: JSON.stringify({ diary: state.diary }),
    });
  } catch (error) {
    accountMessage.textContent = error.message;
  }
}

async function restoreAccount() {
  if (!state.account?.token) {
    updateAccountHud();
    return;
  }
  try {
    const data = await api("/api/me");
    saveSession({ token: state.account.token, username: data.username });
    state.diary = mergeDiary(data.diary || [], state.diary);
    localStorage.setItem(DIARY_KEY, JSON.stringify(state.diary));
    renderDiary();
    await syncDiary();
  } catch {
    saveSession(null);
  }
}

function mergeDiary(remote, local) {
  const byDate = new Map();
  [...remote, ...local].forEach((entry) => {
    if (!entry || !entry.date) return;
    const current = byDate.get(entry.date);
    if (!current || String(entry.time || "") >= String(current.time || "")) {
      byDate.set(entry.date, entry);
    }
  });
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  width = Math.floor(rect.width);
  height = Math.floor(rect.height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutClouds();
}

function slingAnchor() {
  const mobileLift = width < 760 ? 92 : 0;
  return {
    x: Math.max(92, Math.min(width * 0.28, 220)),
    y: height - Math.max(135 + mobileLift, Math.min(height * 0.24 + mobileLift, 190 + mobileLift)),
  };
}

function groundY() {
  return height * 0.82;
}

function layoutClouds() {
  const minX = 78;
  const maxX = Math.max(minX, width - 78);
  const minY = Math.max(112, height * 0.13);
  const maxY = Math.max(minY + 30, height * 0.5 - 48);
  const columns = Math.max(2, Math.min(5, Math.floor(width / 210)));

  state.clouds = state.worries.map((text, index) => {
    const existing = state.clouds.find((cloud) => cloud.text === text && !cloud.dead);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = minX + (col + 0.5) * ((maxX - minX) / columns) + Math.sin(index * 1.7) * 36;
    const y = minY + ((row * 73 + index * 29) % Math.max(60, maxY - minY));
    return {
      id: existing?.id || makeId(),
      text,
      x: existing?.x ?? clamp(x, minX, maxX),
      y: existing?.y ?? clamp(y, minY, maxY),
      baseX: existing?.baseX ?? clamp(x, minX, maxX),
      baseY: existing?.baseY ?? clamp(y, minY, maxY),
      vx: existing?.vx ?? randomVelocity(0.45, 0.9),
      vy: existing?.vy ?? randomVelocity(0.22, 0.58),
      rx: Math.min(92, Math.max(58, 46 + text.length * 9)),
      ry: 36,
      drift: existing?.drift ?? Math.random() * Math.PI * 2,
      hit: 0,
      dead: false,
      taunt: null,
    };
  });
}

function renderWorryList() {
  worryList.innerHTML = "";
  if (!state.worries.length) {
    const empty = document.createElement("span");
    empty.className = "worry-chip";
    empty.textContent = "天空空了，添加一个新靶子";
    worryList.append(empty);
    return;
  }

  state.worries.forEach((text) => {
    const chip = document.createElement("span");
    chip.className = "worry-chip";
    chip.textContent = text;
    worryList.append(chip);
  });
}

function addWorry(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return;
  if (!state.worries.length) state.defeatedToday = [];
  state.worries = [clean, ...state.worries.filter((item) => item !== clean)].slice(0, 12);
  saveWorries();
  layoutClouds();
}

function resetWorries() {
  state.worries = [...DEFAULT_WORRIES];
  state.combo = 0;
  state.upgraded = false;
  state.projectile = null;
  state.particles = [];
  state.floatTexts = [];
  state.defeatedToday = [];
  state.pendingReflection = null;
  reflectionPrompt.classList.add("hidden");
  saveWorries();
  layoutClouds();
  updateHud();
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function canGrabSling(point) {
  const anchor = slingAnchor();
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  return Math.hypot(dx, dy) < 86 && !state.projectile;
}

function startDrag(event) {
  unlockAudio();
  const point = getPointerPosition(event);
  if (!canGrabSling(point)) return;
  canvas.setPointerCapture(event.pointerId);
  state.dragging = true;
  state.pointerId = event.pointerId;
  state.dragPoint = point;
  state.dragStartTime = performance.now();
}

function moveDrag(event) {
  if (!state.dragging || event.pointerId !== state.pointerId) return;
  const anchor = slingAnchor();
  const point = getPointerPosition(event);
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const maxPull = state.upgraded ? 132 : 118;
  const distance = Math.hypot(dx, dy);
  const scale = distance > maxPull ? maxPull / distance : 1;
  state.dragPoint = {
    x: anchor.x + dx * scale,
    y: anchor.y + dy * scale,
  };
}

function endDrag(event) {
  if (!state.dragging || event.pointerId !== state.pointerId) return;
  const anchor = slingAnchor();
  const point = state.dragPoint || anchor;
  const dx = anchor.x - point.x;
  const dy = anchor.y - point.y;
  const pull = Math.hypot(dx, dy);
  const held = Math.min(1.45, 1 + (performance.now() - state.dragStartTime) / 1800);

  if (pull > 12) {
    const speed = (state.upgraded ? 0.28 : 0.24) * held;
    state.projectile = {
      x: anchor.x,
      y: anchor.y,
      vx: dx * speed,
      vy: dy * speed,
      radius: state.upgraded ? 13 : 10,
      bounces: 0,
      alive: true,
      fire: state.upgraded,
      trail: [],
    };
  }

  state.dragging = false;
  state.pointerId = null;
  state.dragPoint = null;
}

function update(dt) {
  const seconds = dt / 1000;
  state.missCooldown = Math.max(0, state.missCooldown - dt);
  state.comboPulse = Math.max(0, state.comboPulse - dt);

  state.clouds.forEach((cloud) => {
    cloud.drift += seconds;
    const wobble = cloud.hit > 0 ? Math.sin(cloud.hit * 0.12) * 8 : 0;
    const minX = cloud.rx + 18;
    const maxX = width - cloud.rx - 18;
    const minY = Math.max(96, cloud.ry + 58);
    const maxY = Math.max(minY + 40, height * 0.5 - cloud.ry);
    cloud.baseX += cloud.vx;
    cloud.baseY += cloud.vy;
    if (cloud.baseX < minX || cloud.baseX > maxX) {
      cloud.baseX = clamp(cloud.baseX, minX, maxX);
      cloud.vx *= -1;
    }
    if (cloud.baseY < minY || cloud.baseY > maxY) {
      cloud.baseY = clamp(cloud.baseY, minY, maxY);
      cloud.vy *= -1;
    }
    cloud.x = cloud.baseX + Math.sin(cloud.drift * 1.25) * 26 + wobble;
    cloud.y = cloud.baseY + Math.cos(cloud.drift * 1.45) * 20;
    cloud.hit = Math.max(0, cloud.hit - dt);
    if (cloud.taunt) {
      cloud.taunt.life -= dt;
      if (cloud.taunt.life <= 0) cloud.taunt = null;
    }
  });

  updateProjectile(dt);
  updateParticles(dt);
  updateFloatTexts(dt);
}

function updateProjectile(dt) {
  const ball = state.projectile;
  if (!ball) return;

  const scale = dt / 16.6667;
  ball.trail.unshift({ x: ball.x, y: ball.y, life: 360 });
  ball.trail = ball.trail.slice(0, ball.fire ? 18 : 9);
  ball.trail.forEach((point) => {
    point.life -= dt;
  });

  ball.vy += 0.38 * scale;
  ball.x += ball.vx * scale;
  ball.y += ball.vy * scale;

  const hitCloud = state.clouds.find((cloud) => !cloud.dead && intersectsCloud(ball, cloud));
  if (hitCloud) {
    hitCloud.dead = true;
    hitCloud.hit = 520;
    spawnBurst(hitCloud.x, hitCloud.y, ball.fire);
    playHitSound(ball.fire);
    spawnFloatText(randomOf(SCREAMS), hitCloud.x, hitCloud.y - 42, "#f04f42", 920);
    state.defeatedToday.push(hitCloud.text);
    state.worries = state.worries.filter((item) => item !== hitCloud.text);
    state.clouds = state.clouds.filter((cloud) => cloud !== hitCloud);
    state.combo += 1;
    state.comboPulse = 520;
    if (state.combo >= 3) state.upgraded = true;
    saveWorries();
    updateHud();
    state.projectile = null;
    if (!state.clouds.length) queueDailyReflection();
    return;
  }

  const floor = groundY() - ball.radius;
  if (ball.y > floor) {
    ball.y = floor;
    ball.vy *= -0.36;
    ball.vx *= 0.58;
    ball.bounces += 1;
    spawnDust(ball.x, floor + ball.radius);
    if (ball.bounces >= 1 || Math.abs(ball.vy) < 2) {
      miss();
      state.projectile = null;
    }
  }

  if (ball.x < -80 || ball.x > width + 80 || ball.y < -120 || ball.y > height + 80) {
    miss();
    state.projectile = null;
  }
}

function intersectsCloud(ball, cloud) {
  const nx = (ball.x - cloud.x) / cloud.rx;
  const ny = (ball.y - cloud.y) / cloud.ry;
  return nx * nx + ny * ny <= 1.08 + ball.radius / 80;
}

function miss() {
  if (state.missCooldown > 0) return;
  state.missCooldown = 400;
  state.combo = 0;
  updateHud();
  const cloud = randomOf(state.clouds);
  if (cloud) {
    cloud.taunt = { text: randomOf(TAUNTS), life: 1400 };
    cloud.hit = 300;
  } else {
    spawnFloatText("都打完了，添一朵新的吧", width * 0.5, height * 0.34, "#30516d", 1400);
  }
}

function spawnBurst(x, y, fire) {
  for (let i = 0; i < 34; i += 1) {
    const angle = (Math.PI * 2 * i) / 34 + Math.random() * 0.24;
    const speed = 1.8 + Math.random() * (fire ? 5.8 : 4.2);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2,
      size: 4 + Math.random() * 8,
      life: 720 + Math.random() * 380,
      maxLife: 1100,
      color: fire ? randomOf(["#ff3d22", "#ff9f1c", "#ffd166"]) : randomOf(COLORS),
      shape: Math.random() > 0.45 ? "star" : "rainbow",
    });
  }
}

function spawnDust(x, y) {
  for (let i = 0; i < 8; i += 1) {
    state.particles.push({
      x,
      y,
      vx: -2 + Math.random() * 4,
      vy: -1 - Math.random() * 2.2,
      size: 4 + Math.random() * 8,
      life: 380,
      maxLife: 380,
      color: "rgba(255,255,255,0.7)",
      shape: "dot",
    });
  }
}

function spawnFloatText(text, x, y, color, life) {
  state.floatTexts.push({ text, x, y, vy: -0.32, color, life, maxLife: life });
}

function updateParticles(dt) {
  const scale = dt / 16.6667;
  state.particles.forEach((particle) => {
    particle.life -= dt;
    particle.vy += 0.08 * scale;
    particle.x += particle.vx * scale;
    particle.y += particle.vy * scale;
  });
  state.particles = state.particles.filter((particle) => particle.life > 0);
}

function updateFloatTexts(dt) {
  const scale = dt / 16.6667;
  state.floatTexts.forEach((text) => {
    text.life -= dt;
    text.y += text.vy * scale;
  });
  state.floatTexts = state.floatTexts.filter((text) => text.life > 0);
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  drawBackground();
  drawClouds();
  drawParticles();
  drawSlingshot();
  drawProjectile();
  drawFloatTexts();
}

function drawBackground() {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (let i = 0; i < 7; i += 1) {
    const x = ((performance.now() * 0.012 + i * 230) % (width + 260)) - 160;
    const y = 82 + (i % 3) * 58;
    drawPuffyCloud(x, y, 44 + (i % 2) * 12, "", 0.28);
  }

  ctx.fillStyle = "#4fa65b";
  ctx.beginPath();
  ctx.moveTo(0, groundY() + 26);
  for (let x = 0; x <= width + 40; x += 40) {
    ctx.lineTo(x, groundY() + 22 + Math.sin(x * 0.018) * 10);
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawClouds() {
  state.clouds.forEach((cloud) => {
    ctx.save();
    const squash = cloud.hit > 0 ? 1 + Math.sin(cloud.hit * 0.16) * 0.06 : 1;
    ctx.translate(cloud.x, cloud.y);
    ctx.scale(1 / squash, squash);
    drawPuffyCloud(0, 0, cloud.rx, cloud.text, 1, cloud.ry);
    ctx.restore();

    if (cloud.taunt) {
      const alpha = Math.min(1, cloud.taunt.life / 280);
      drawSpeech(cloud.taunt.text, cloud.x, cloud.y - 58, alpha);
    }
  });

  if (!state.clouds.length) {
    ctx.save();
    ctx.fillStyle = "rgba(37,52,71,0.72)";
    ctx.font = "800 24px Microsoft YaHei, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("所有的担忧都是你的手下败将。爱自己，你就是无敌的。", width / 2, height * 0.34);
    ctx.restore();
  }
}

function drawPuffyCloud(x, y, rx, text, alpha = 1, ry = 36) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.beginPath();
  ctx.ellipse(0, 6, rx, ry, 0, 0, Math.PI * 2);
  ctx.ellipse(-rx * 0.42, -4, rx * 0.38, ry * 0.82, 0, 0, Math.PI * 2);
  ctx.ellipse(0, -14, rx * 0.45, ry, 0, 0, Math.PI * 2);
  ctx.ellipse(rx * 0.42, -3, rx * 0.38, ry * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (text) {
    const fontSize = Math.max(14, Math.min(24, (rx * 1.35) / Math.max(2, text.length)));
    ctx.fillStyle = "#39506a";
    ctx.font = `900 ${fontSize}px Microsoft YaHei, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 4, rx * 1.45);
  }
  ctx.restore();
}

function drawSpeech(text, x, y, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "800 15px Microsoft YaHei, sans-serif";
  const metrics = ctx.measureText(text);
  const boxWidth = Math.min(190, metrics.width + 28);
  roundRect(x - boxWidth / 2, y - 18, boxWidth, 34, 8);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(66,83,103,0.14)";
  ctx.stroke();
  ctx.fillStyle = "#f05a46";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - 1, boxWidth - 18);
  ctx.restore();
}

function drawSlingshot() {
  const anchor = slingAnchor();
  const hand = state.dragPoint || anchor;
  const leftFork = { x: anchor.x - 24, y: anchor.y - 42 };
  const rightFork = { x: anchor.x + 24, y: anchor.y - 42 };
  const wood = state.upgraded ? "#5b3428" : "#7a4a2b";
  const band = state.upgraded ? "#ff6b3a" : "#4a2f28";

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = "rgba(45,70,55,0.22)";
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y + 76);
  ctx.lineTo(anchor.x, anchor.y + 6);
  ctx.stroke();

  ctx.strokeStyle = wood;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y + 76);
  ctx.lineTo(anchor.x, anchor.y + 8);
  ctx.lineTo(leftFork.x, leftFork.y);
  ctx.moveTo(anchor.x, anchor.y + 8);
  ctx.lineTo(rightFork.x, rightFork.y);
  ctx.stroke();

  if (state.dragging) {
    drawTrajectory(anchor, hand);
    const held = Math.min(1, (performance.now() - state.dragStartTime) / 1800);
    ctx.strokeStyle = `rgba(255, 107, 74, ${0.22 + held * 0.45})`;
    ctx.lineWidth = 3 + held * 7;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 22 + held * 24, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = band;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(leftFork.x, leftFork.y);
  ctx.lineTo(hand.x, hand.y);
  ctx.lineTo(rightFork.x, rightFork.y);
  ctx.stroke();

  if (!state.projectile) drawAmmo(hand.x, hand.y, state.upgraded, 1);
  ctx.restore();
}

function drawTrajectory(anchor, hand) {
  const dx = anchor.x - hand.x;
  const dy = anchor.y - hand.y;
  const held = Math.min(1.45, 1 + (performance.now() - state.dragStartTime) / 1800);
  let vx = dx * (state.upgraded ? 0.28 : 0.24) * held;
  let vy = dy * (state.upgraded ? 0.28 : 0.24) * held;
  let x = anchor.x;
  let y = anchor.y;

  ctx.save();
  ctx.fillStyle = "rgba(37,52,71,0.32)";
  for (let i = 0; i < 22; i += 1) {
    vy += 0.38 * 4;
    x += vx * 4;
    y += vy * 4;
    if (i % 2 === 0) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, 5 - i * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
    if (y > groundY()) break;
  }
  ctx.restore();
}

function drawProjectile() {
  const ball = state.projectile;
  if (!ball) return;
  ball.trail.forEach((point, index) => {
    const alpha = Math.max(0, point.life / 360) * (1 - index / ball.trail.length);
    drawAmmo(point.x, point.y, ball.fire, alpha * 0.55);
  });
  drawAmmo(ball.x, ball.y, ball.fire, 1);
}

function drawAmmo(x, y, fire, alpha) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (fire) {
    const flame = ctx.createRadialGradient(x, y, 2, x, y, 24);
    flame.addColorStop(0, "#fff3a3");
    flame.addColorStop(0.45, "#ff8a1f");
    flame.addColorStop(1, "rgba(255,61,34,0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = fire ? "#2c2b2a" : "#5b6170";
  ctx.beginPath();
  ctx.arc(x, y, fire ? 12 : 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(x - 4, y - 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  state.particles.forEach((particle) => {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(particle.x, particle.y);
    ctx.rotate((particle.maxLife - particle.life) * 0.012);
    ctx.fillStyle = particle.color;
    if (particle.shape === "star") {
      drawStar(0, 0, particle.size, particle.size * 0.45);
    } else if (particle.shape === "rainbow") {
      ctx.fillRect(-particle.size * 0.8, -particle.size * 0.25, particle.size * 1.6, particle.size * 0.5);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, particle.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function drawFloatTexts() {
  state.floatTexts.forEach((item) => {
    const alpha = Math.min(1, item.life / 260);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = item.color;
    ctx.font = "900 24px Microsoft YaHei, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeText(item.text, item.x, item.y);
    ctx.fillText(item.text, item.x, item.y);
    ctx.restore();
  });
}

function drawStar(x, y, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function updateHud() {
  comboValue.textContent = String(state.combo);
  modeValue.textContent = state.upgraded ? "火焰弹" : "石子";
  comboValue.style.transform = state.comboPulse > 0 ? "scale(1.18)" : "scale(1)";
}

function unlockAudio() {
  if (!state.audio) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audio = new AudioContext();
  }
  if (state.audio.state === "suspended") {
    state.audio.resume();
  }
}

function playHitSound(fire = false) {
  unlockAudio();
  const audio = state.audio;
  if (!audio) return;

  const now = audio.currentTime;
  const master = audio.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(fire ? 0.24 : 0.2, now + 0.014);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
  master.connect(audio.destination);

  const pop = audio.createOscillator();
  pop.type = "triangle";
  pop.frequency.setValueAtTime(fire ? 220 : 260, now);
  pop.frequency.exponentialRampToValueAtTime(fire ? 520 : 460, now + 0.08);
  pop.frequency.exponentialRampToValueAtTime(fire ? 340 : 320, now + 0.28);
  pop.connect(master);
  pop.start(now);
  pop.stop(now + 0.32);

  const lift = audio.createOscillator();
  const liftGain = audio.createGain();
  lift.type = "sine";
  lift.frequency.setValueAtTime(fire ? 660 : 560, now + 0.045);
  lift.frequency.exponentialRampToValueAtTime(fire ? 880 : 740, now + 0.22);
  liftGain.gain.setValueAtTime(0.0001, now + 0.035);
  liftGain.gain.exponentialRampToValueAtTime(fire ? 0.105 : 0.085, now + 0.075);
  liftGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  lift.connect(liftGain);
  liftGain.connect(master);
  lift.start(now + 0.035);
  lift.stop(now + 0.44);

  const chime = audio.createOscillator();
  const chimeGain = audio.createGain();
  chime.type = "sine";
  chime.frequency.setValueAtTime(fire ? 1180 : 1040, now + 0.105);
  chimeGain.gain.setValueAtTime(0.0001, now + 0.1);
  chimeGain.gain.exponentialRampToValueAtTime(fire ? 0.07 : 0.055, now + 0.125);
  chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  chime.connect(chimeGain);
  chimeGain.connect(master);
  chime.start(now + 0.1);
  chime.stop(now + 0.32);

  const ping = audio.createOscillator();
  const pingGain = audio.createGain();
  ping.type = "triangle";
  ping.frequency.setValueAtTime(fire ? 1580 : 1420, now + 0.04);
  ping.frequency.exponentialRampToValueAtTime(fire ? 1320 : 1180, now + 0.13);
  pingGain.gain.setValueAtTime(0.0001, now + 0.035);
  pingGain.gain.exponentialRampToValueAtTime(fire ? 0.052 : 0.043, now + 0.05);
  pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.145);
  ping.connect(pingGain);
  pingGain.connect(master);
  ping.start(now + 0.035);
  ping.stop(now + 0.16);

  const noise = audio.createBufferSource();
  const noiseBuffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.09), audio.sampleRate);
  const channel = noiseBuffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = (Math.random() * 2 - 1) * 0.34 * (1 - i / channel.length);
  }
  const noiseGain = audio.createGain();
  noiseGain.gain.setValueAtTime(fire ? 0.045 : 0.034, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  noise.buffer = noiseBuffer;
  noise.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(now);
  noise.stop(now + 0.1);
}

function queueDailyReflection() {
  if (!state.defeatedToday.length || state.pendingReflection) return;
  const now = new Date();
  state.pendingReflection = {
    id: makeId(),
    worries: [...state.defeatedToday],
    date: formatDateKey(now),
    time: formatTime(now),
    reflection: "",
  };
  encourageText.textContent = FINAL_ENCOURAGEMENT;
  reflectionInput.value = "";
  reflectionPrompt.classList.remove("hidden");
  setTimeout(() => reflectionInput.focus(), 80);
}

function savePendingReflection(skipText = false) {
  if (!state.pendingReflection) return;
  const text = reflectionInput.value.trim();
  const entry = {
    ...state.pendingReflection,
    reflection: skipText || !text ? "今天没有写下感想，但这些烦恼已经被击败。" : text,
  };
  state.diary = [entry, ...state.diary.filter((item) => item.date !== entry.date)].slice(0, 90);
  state.defeatedToday = [];
  state.pendingReflection = null;
  saveDiary();
  renderDiary();
  reflectionPrompt.classList.add("hidden");
}

function renderDiary(selectedDate = null) {
  diaryEntries.innerHTML = "";
  if (!state.diary.length) {
    const empty = document.createElement("div");
    empty.className = "empty-diary";
    empty.textContent = state.account
      ? "还没有记录。清空今天的烦恼云后，可以把那一刻的想法留在这里。"
      : "还没有记录。登录账户后，之后保存的每日记录会跟随账户同步。";
    diaryEntries.append(empty);
    return;
  }

  const ordered = [...state.diary].sort((a, b) => b.date.localeCompare(a.date));
  const selected = selectedDate ? ordered.find((entry) => entry.date === selectedDate) : null;
  if (selected) {
    renderDiaryDetail(selected);
    return;
  }

  ordered.forEach((entry) => {
    const button = document.createElement("button");
    button.className = "diary-date-button";
    button.type = "button";
    const date = document.createElement("span");
    date.textContent = formatDateLabel(entry.date);
    const count = document.createElement("strong");
    count.textContent = `击败 ${entry.worries.length} 朵烦恼`;
    button.append(date, count);
    button.addEventListener("click", () => renderDiary(entry.date));
    diaryEntries.append(button);
  });
}

function renderDiaryDetail(entry) {
  const back = document.createElement("button");
  back.className = "diary-back";
  back.type = "button";
  back.textContent = "← 返回日期";
  back.addEventListener("click", () => renderDiary());

  const day = document.createElement("article");
  day.className = "diary-day";

  const title = document.createElement("div");
  title.className = "diary-date";
  title.textContent = `${formatDateLabel(entry.date)} ${entry.time}`;

  const clouds = document.createElement("div");
  clouds.className = "diary-clouds";
  entry.worries.forEach((text) => {
    const worry = document.createElement("div");
    worry.className = "diary-worry";
    worry.textContent = text;
    clouds.append(worry);
  });

  const reflection = document.createElement("p");
  reflection.className = "diary-reflection";
  reflection.textContent = entry.reflection;

  day.append(title, clouds, reflection);
  diaryEntries.append(back, day);
}

function openDiary() {
  renderDiary();
  diaryDrawer.classList.remove("hidden");
}

function closeDiaryDrawer() {
  diaryDrawer.classList.add("hidden");
}

function updateAccountHud() {
  accountLabel.textContent = state.account?.username || "登录";
  logoutButton.classList.toggle("hidden", !state.account);
}

function openAccountModal() {
  accountMessage.textContent = "";
  usernameInput.value = state.account?.username || "";
  passwordInput.value = "";
  accountModal.classList.remove("hidden");
  renderAccountMode();
  if (location.protocol === "file:") {
    accountMessage.textContent = "账户功能需要通过服务地址打开：先运行 node server.js，再访问 http://127.0.0.1:4173";
  }
  setTimeout(() => (state.account ? passwordInput : usernameInput).focus(), 60);
}

function closeAccountModal() {
  accountModal.classList.add("hidden");
}

function renderAccountMode() {
  const isRegister = state.authMode === "register";
  accountTitle.textContent = isRegister ? "创建账户" : "登录账户";
  accountHint.textContent = isRegister
    ? "创建后会把当前浏览器里的每日记录同步到这个账户。"
    : "登录后，每日记录会保存到账户里，换浏览器也能找回来。";
  submitAccount.textContent = isRegister ? "创建并登录" : "登录";
  toggleAccountMode.textContent = isRegister ? "已有账户？去登录" : "没有账户？创建一个";
}

async function submitAccountForm(event) {
  event.preventDefault();
  accountMessage.textContent = "";
  submitAccount.disabled = true;
  try {
    const endpoint = state.authMode === "register" ? "/api/register" : "/api/login";
    const data = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
      }),
    });
    saveSession({ token: data.token, username: data.username });
    state.diary = mergeDiary(data.diary || [], state.diary);
    localStorage.setItem(DIARY_KEY, JSON.stringify(state.diary));
    await syncDiary();
    renderDiary();
    closeAccountModal();
  } catch (error) {
    accountMessage.textContent = error.message;
  } finally {
    submitAccount.disabled = false;
  }
}

function toggleAccountModeAction() {
  state.authMode = state.authMode === "login" ? "register" : "login";
  accountMessage.textContent = "";
  renderAccountMode();
}

function logout() {
  saveSession(null);
  accountMessage.textContent = "已退出。当前浏览器里的本地记录仍会保留。";
  renderAccountMode();
  renderDiary();
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function randomOf(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function makeId() {
  return `cloud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function randomVelocity(min, max) {
  const speed = min + Math.random() * (max - min);
  return Math.random() > 0.5 ? speed : -speed;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loop(now) {
  const frame = Math.min(48, now - lastTime);
  lastTime = now;
  accumulator += frame;
  while (accumulator >= step) {
    update(step);
    accumulator -= step;
  }
  draw();
  requestAnimationFrame(loop);
}

worryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addWorry(worryInput.value);
  worryInput.value = "";
  worryInput.focus();
});

resetButton.addEventListener("click", resetWorries);
diaryButton.addEventListener("click", openDiary);
closeDiary.addEventListener("click", closeDiaryDrawer);
saveReflection.addEventListener("click", () => savePendingReflection(false));
skipReflection.addEventListener("click", () => savePendingReflection(true));
accountButton.addEventListener("click", openAccountModal);
closeAccount.addEventListener("click", closeAccountModal);
accountForm.addEventListener("submit", submitAccountForm);
toggleAccountMode.addEventListener("click", toggleAccountModeAction);
logoutButton.addEventListener("click", logout);
reflectionInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    savePendingReflection(false);
  }
});
canvas.addEventListener("pointerdown", startDrag);
canvas.addEventListener("pointermove", moveDrag);
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
window.addEventListener("resize", resize);

renderWorryList();
renderDiary();
updateAccountHud();
restoreAccount();
resize();
updateHud();
requestAnimationFrame(loop);
