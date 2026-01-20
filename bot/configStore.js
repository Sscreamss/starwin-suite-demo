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

    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify(this.defaultConfig(), null, 2), "utf-8");
    }
  }

  defaultConfig() {
    return {
      appName: "Starwin Suite",
      url: "www.ganamos.tech",
      usernameSuffix: "_starwin",
      fixedPassword: "Hola1234",

      // ✅ Bienvenida siempre + cooldown (0 = siempre responde)
      welcome: {
        cooldownSeconds: 0
      },

      menu: {
        welcome: "¡Hola! ¿Cómo podemos ayudarte?",
        buttons: ["INFORMACIÓN", "CREAR USUARIO", "ASISTENCIA"]
      },

      info: {
        text:
          "📲 Somos líderes\nwww.ganamos.tech\n- Mínimo de carga: $1.000\n- Mínimo de retiro: $3.000\n- Retiros ilimitados\n- Atención 24hs"
      },

      support: {
        text: "POR SOPORTE PERSONALIZADO COMUNIQUESE AL 11 7171-7171"
      },

      createUser: {
        askName: "Perfecto ✅\nDecime tu nombre (solo tu nombre, por ejemplo: Juan).",
        invalidName: "Te leo 🙌 Mandame solo tu nombre (sin números, emojis ni símbolos).",
        creating: "Dale, un segundo… estoy creando tu usuario ✅",
        createdTemplate:
          "✅ ¡Listo! Tu usuario ya fue creado.\n\nUSUARIO: {{username}}\nCONTRASEÑA: {{password}}\n\nEntrá acá: {{url}}"
      },

      safety: {
        // si querés frenar spam global, subilo (ej: 3–5). Para test ponelo en 0.
        rateLimitSeconds: 0
      }
    };
  }

  get() {
    return JSON.parse(fs.readFileSync(this.file, "utf-8"));
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
