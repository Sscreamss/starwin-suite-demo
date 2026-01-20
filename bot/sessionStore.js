// bot/sessionStore.js
const fs = require("fs");
const path = require("path");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

class SessionStore {
  constructor({ basePath }) {
    this.basePath = basePath;
    this.dir = path.join(basePath, "sessions");
    this.file = path.join(this.dir, "sessions.json");
    ensureDir(this.dir);

    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify({}, null, 2), "utf-8");
    }

    this.cache = this._readAll();
  }

  _readAll() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf-8")) || {};
    } catch {
      return {};
    }
  }

  _writeAll() {
    fs.writeFileSync(this.file, JSON.stringify(this.cache, null, 2), "utf-8");
  }

  key(lineId, chatId) {
    return `${lineId}::${chatId}`;
  }

  get(lineId, chatId) {
    const k = this.key(lineId, chatId);
    return this.cache[k] || null;
  }

  set(lineId, chatId, session) {
    const k = this.key(lineId, chatId);
    this.cache[k] = session;
    this._writeAll();
    return session;
  }

  upsert(lineId, chatId, fn) {
    const prev = this.get(lineId, chatId) || {
      lineId,
      chatId,
      state: "MENU",
      data: {},
      meta: { createdAt: Date.now(), updatedAt: Date.now(), lastActionAt: 0, attempts: 0 }
    };

    const next = fn(prev);
    next.meta = next.meta || {};
    next.meta.updatedAt = Date.now();
    this.set(lineId, chatId, next);
    return next;
  }

  count() {
    return Object.keys(this.cache).length;
  }
}

module.exports = { SessionStore };
