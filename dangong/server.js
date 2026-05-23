const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const store = JSON.parse(raw);
    return { users: store.users || {}, sessions: store.sessions || {} };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { users: {}, sessions: {} };
  }
}

async function writeStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("请求太大");
  }
  return body ? JSON.parse(body) : {};
}

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsername(username) {
  return /^[a-z0-9_\u4e00-\u9fa5-]{2,24}$/i.test(username);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const next = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(next.hash, "hex"), Buffer.from(user.hash, "hex"));
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function requireUser(req, res) {
  const store = await readStore();
  const session = store.sessions[getToken(req)];
  if (!session || !store.users[session.username]) {
    sendJson(res, 401, { error: "请先登录账户" });
    return null;
  }
  return { store, username: session.username };
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/register" && req.method === "POST") {
      const input = await readJson(req);
      const username = cleanUsername(input.username);
      const password = String(input.password || "");
      if (!validateUsername(username)) return sendJson(res, 400, { error: "用户名需为 2-24 位，可含中文、字母、数字、_ 或 -" });
      if (password.length < 6) return sendJson(res, 400, { error: "密码至少 6 位" });

      const store = await readStore();
      if (store.users[username]) return sendJson(res, 409, { error: "这个用户名已经存在" });
      const token = makeToken();
      store.users[username] = {
        username,
        ...hashPassword(password),
        diary: [],
        createdAt: new Date().toISOString(),
      };
      store.sessions[token] = { username, createdAt: new Date().toISOString() };
      await writeStore(store);
      return sendJson(res, 200, { token, username, diary: [] });
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const input = await readJson(req);
      const username = cleanUsername(input.username);
      const password = String(input.password || "");
      const store = await readStore();
      const user = store.users[username];
      if (!user || !verifyPassword(password, user)) return sendJson(res, 401, { error: "用户名或密码不正确" });
      const token = makeToken();
      store.sessions[token] = { username, createdAt: new Date().toISOString() };
      await writeStore(store);
      return sendJson(res, 200, { token, username, diary: user.diary || [] });
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      const session = await requireUser(req, res);
      if (!session) return;
      const user = session.store.users[session.username];
      return sendJson(res, 200, { username: session.username, diary: user.diary || [] });
    }

    if (url.pathname === "/api/diary" && req.method === "GET") {
      const session = await requireUser(req, res);
      if (!session) return;
      return sendJson(res, 200, { diary: session.store.users[session.username].diary || [] });
    }

    if (url.pathname === "/api/diary" && req.method === "PUT") {
      const session = await requireUser(req, res);
      if (!session) return;
      const input = await readJson(req);
      if (!Array.isArray(input.diary)) return sendJson(res, 400, { error: "日记格式不正确" });
      session.store.users[session.username].diary = input.diary.slice(0, 90);
      await writeStore(session.store);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "接口不存在" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "服务器错误" });
  }
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`烦恼弹弓已启动：http://${HOST}:${PORT}`);
});
