import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

function writeSite(data) {
  data.updatedAt = new Date().toISOString();
  const temporary = `${SITE_FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, SITE_FILE);
}

function getCookie(request, name) {
  const header = request.headers.cookie || "";
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function currentSession(request) {
  const token = getCookie(request, "masjid_session");
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireAdmin(request, response) {
  const session = currentSession(request);
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
      sendJson(response, 200, readJson(SITE_FILE));
      return;
    }

    if (request.method === "GET" && pathname === "/api/session") {
      const session = currentSession(request);
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
      sessions.set(token, { username: admin.username, expires: Date.now() + SESSION_MAX_AGE });
      sendJson(response, 200, { ok: true, username: admin.username }, {
        "Set-Cookie": `masjid_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}`
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/logout") {
      const session = currentSession(request);
      if (session) sessions.delete(session.token);
      sendJson(response, 200, { ok: true }, {
        "Set-Cookie": "masjid_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
      });
      return;
    }

    if (request.method === "PUT" && pathname === "/api/site") {
      if (!requireAdmin(request, response)) return;
      const site = await bodyJson(request);
      if (!safeSiteConfig(site)) {
        sendJson(response, 400, { error: "The website settings are incomplete or unsafe." });
        return;
      }
      writeSite(site);
      sendJson(response, 200, readJson(SITE_FILE));
      return;
    }

    staticFile(request, response, pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "The server could not complete that request." });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
}, 1000 * 60 * 15).unref();

server.listen(PORT, () => console.log(`Masjid Ar-Rahman website is running at http://localhost:${PORT}`));
