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

  // Limpiar sesiones incompletas (sin 'completed' flag)
  cleanIncompleted() {
    const before = Object.keys(this.cache).length;
    const cleaned = {};
    
    for (const [k, session] of Object.entries(this.cache)) {
      if (session.completed === true) {
        cleaned[k] = session;
      }
    }
    
    this.cache = cleaned;
    this._writeAll();
    
    const after = Object.keys(this.cache).length;
    console.log(`[SessionStore] Limpiadas ${before - after} sesiones incompletas`);
  }

  // Resetear sesión si pasó >X horas sin actividad
  resetIfInactive(lineId, chatId, inactiveHours = 2) {
    const session = this.get(lineId, chatId);
    if (!session) return false;

    const lastAction = session.meta?.lastActionAt || 0;
    const now = Date.now();
    const inactiveMs = inactiveHours * 60 * 60 * 1000;

    if (now - lastAction > inactiveMs) {
      console.log(`[${lineId}] Sesión inactiva >2 horas, reseteando a MENU`);
      return this.upsert(lineId, chatId, (s) => {
        s.state = "MENU";
        s.data = {};
        s.completed = false; // ✅ FIX: Limpiar completed para que el usuario pueda empezar de nuevo
        return s;
      });
    }
    
    return false;
  }
}

module.exports = { SessionStore };