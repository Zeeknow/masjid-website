import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";

const ROOT = resolve(".");
const PUBLIC = resolve(ROOT, "public");
const ADMIN_PAGE = resolve(ROOT, "views", "admin.html");
const SITE_FILE = resolve(ROOT, "data", "site.json");
const ENV_FILE = resolve(ROOT, ".env");
const LEGACY_ADMIN_FILE = resolve(ROOT, "data", "admin.json");

function loadEnvironment(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvironment(ENV_FILE);
const PORT = Number(process.env.PORT || 3000);
const KV_REST_API_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KV_ENABLED = Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
const SITE_KV_KEY = "masjid-ar-rahman:site:v1";
const SESSION_KV_PREFIX = "masjid-ar-rahman:session:";
const sessions = new Map();
const SESSION_MAX_AGE = 1000 * 60 * 60 * 8;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function kvCommand(command) {
  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(`KV storage request failed${payload.error ? `: ${payload.error}` : ""}`);
  }
  return payload.result;
}

async function readSite() {
  if (!KV_ENABLED) return readJson(SITE_FILE);
  const stored = await kvCommand(["GET", SITE_KV_KEY]);
  if (stored) return JSON.parse(stored);
  const initialSite = readJson(SITE_FILE);
  await kvCommand(["SET", SITE_KV_KEY, JSON.stringify(initialSite)]);
  return initialSite;
}

function configuredAdmin() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD_SALT, ADMIN_PASSWORD_HASH } = process.env;
  if (ADMIN_USERNAME && ADMIN_PASSWORD_SALT && ADMIN_PASSWORD_HASH) {
    return { username: ADMIN_USERNAME, salt: ADMIN_PASSWORD_SALT, hash: ADMIN_PASSWORD_HASH };
  }
  return existsSync(LEGACY_ADMIN_FILE) ? readJson(LEGACY_ADMIN_FILE) : null;
}

function send(res, status, content, type = "application/json; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self' https://api.aladhan.com; frame-src https://www.google.com; base-uri 'self'; form-action 'self'",
    ...extraHeaders
  });
  res.end(content);
}

function sendJson(res, status, data, headers) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8", headers);
}

function safeSiteConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const serialized = JSON.stringify(value);
  if (serialized.length > 120000 || /<\s*script|javascript\s*:/i.test(serialized)) return false;
  return value.identity && value.prayerLocation && value.contact && value.donations && value.social && Array.isArray(value.announcements);
}

async function writeSite(data) {
  data.updatedAt = new Date().toISOString();
  const content = JSON.stringify(data, null, 2) + "\n";
  if (KV_ENABLED) {
    await kvCommand(["SET", SITE_KV_KEY, content]);
    return;
  }
  const temporary = `${SITE_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, SITE_FILE);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // The next write uses a unique temporary filename, so cleanup can wait.
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      // Some Windows file-sync tools temporarily prevent an atomic rename.
      // The direct write keeps dashboard updates available in that case.
      writeFileSync(SITE_FILE, content, { mode: 0o600 });
      return;
    }
    throw error;
  }
}

function getCookie(request, name) {
  const header = request.headers.cookie || "";
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function sessionKey(token) {
  return `${SESSION_KV_PREFIX}${token}`;
}

async function currentSession(request) {
  const token = getCookie(request, "masjid_session");
  if (!token) return null;
  if (KV_ENABLED) {
    const stored = await kvCommand(["GET", sessionKey(token)]);
    if (!stored) return null;
    let session;
    try {
      session = JSON.parse(stored);
    } catch {
      await kvCommand(["DEL", sessionKey(token)]);
      return null;
    }
    if (session.expires < Date.now()) {
      await kvCommand(["DEL", sessionKey(token)]);
      return null;
    }
    return { token, ...session };
  }
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

async function createSession(token, session) {
  if (KV_ENABLED) {
    await kvCommand(["SET", sessionKey(token), JSON.stringify(session), "EX", Math.ceil(SESSION_MAX_AGE / 1000)]);
    return;
  }
  sessions.set(token, session);
}

async function deleteSession(token) {
  if (!token) return;
  if (KV_ENABLED) {
    await kvCommand(["DEL", sessionKey(token)]);
    return;
  }
  sessions.delete(token);
}

async function requireAdmin(request, response) {
  const session = await currentSession(request);
  if (!session) {
    sendJson(response, 401, { error: "Please sign in to continue." });
    return null;
  }
  return session;
}

function bodyJson(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 150000) reject(new Error("Request is too large."));
    });
    request.on("end", () => {
      try { resolveBody(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON.")); }
    });
    request.on("error", reject);
  });
}

function samePassword(password, admin) {
  const candidate = scryptSync(String(password), admin.salt, 64);
  const expected = Buffer.from(admin.hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function staticFile(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = resolve(PUBLIC, `.${normalize(requested)}`);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self' https://api.aladhan.com; frame-src https://www.google.com; base-uri 'self'; form-action 'self'"
  });
  createReadStream(file).pipe(response);
}

function adminPage(response) {
  if (!existsSync(ADMIN_PAGE)) {
    send(response, 500, "Admin page is unavailable.", "text/plain; charset=utf-8");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self' https://api.aladhan.com; frame-src https://www.google.com; base-uri 'self'; form-action 'self'"
  });
  createReadStream(ADMIN_PAGE).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const { pathname } = url;

  try {
    if (request.method === "GET" && ["/admin", "/admin/", "/admin/login"].includes(pathname)) {
      adminPage(response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/site") {
      sendJson(response, 200, await readSite());
      return;
    }

    if (request.method === "GET" && pathname === "/api/session") {
      const session = await currentSession(request);
      sendJson(response, 200, { authenticated: Boolean(session), username: session?.username || null });
      return;
    }

    if (request.method === "POST" && pathname === "/api/login") {
      const admin = configuredAdmin();
      if (!admin) {
        sendJson(response, 503, { error: "Admin login is not configured. Run npm run setup-admin first." });
        return;
      }
      const { username, password } = await bodyJson(request);
      if (username !== admin.username || !samePassword(password, admin)) {
        sendJson(response, 401, { error: "Incorrect username or password." });
        return;
      }
      const token = randomBytes(32).toString("hex");
      await createSession(token, { username: admin.username, expires: Date.now() + SESSION_MAX_AGE });
      const isSecureRequest = process.env.VERCEL === "1" || request.headers["x-forwarded-proto"] === "https";
      sendJson(response, 200, { ok: true, username: admin.username }, {
        "Set-Cookie": `masjid_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}${isSecureRequest ? "; Secure" : ""}`
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/logout") {
      const session = await currentSession(request);
      if (session) await deleteSession(session.token);
      sendJson(response, 200, { ok: true }, {
        "Set-Cookie": "masjid_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
      });
      return;
    }

    if (request.method === "PUT" && pathname === "/api/site") {
      if (!await requireAdmin(request, response)) return;
      const site = await bodyJson(request);
      if (!safeSiteConfig(site)) {
        sendJson(response, 400, { error: "The website settings are incomplete or unsafe." });
        return;
      }
      await writeSite(site);
      sendJson(response, 200, site);
      return;
    }

    staticFile(request, response, pathname);
  } catch (error) {
    console.error(error);
    const isWriteAccessError = error?.code === "EACCES" || error?.code === "EPERM";
    sendJson(response, 500, {
      error: isWriteAccessError
        ? "The website settings file is locked or read-only. Restart the server and make sure the data folder allows writing."
        : "The server could not complete that request. Restart the server and try saving again."
    });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
}, 1000 * 60 * 15).unref();

server.listen(PORT, () => console.log(`Masjid Ar-Rahman website is running at http://localhost:${PORT}`));
