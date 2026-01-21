// bot/configStore.js
const fs = require("fs");
const path = require("path");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

class ConfigStore {
  constructor({ basePath }) {
    this.basePath = basePath;
    this.dir = path.join(basePath, "config");
    this.file = path.join(this.dir, "bot-config.json");
    ensureDir(this.dir);
  }

  get() {
    try {
      console.log(`[ConfigStore] Leyendo desde: ${this.file}`);
      const rawData = fs.readFileSync(this.file, "utf-8");
      const data = JSON.parse(rawData);
      console.log(`[ConfigStore] Archivo leído. Keys createUser:`, Object.keys(data.createUser || {}));
      console.log(`[ConfigStore] askDeposit =`, data.createUser?.askDeposit);
      return data;
    } catch (e) {
      console.error(`[ConfigStore] ERROR leyendo config:`, e.message);
      throw e;
    }
  }

  update(patch) {
    const current = this.get();
    const next = deepMerge(current, patch || {});
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }
}

function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice();
  if (typeof b !== "object" || b === null) return b;
  const out = { ...(a || {}) };
  for (const k of Object.keys(b)) {
    out[k] = deepMerge(out[k], b[k]);
  }
  return out;
}

module.exports = { ConfigStore };
