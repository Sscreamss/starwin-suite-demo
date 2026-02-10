// bot/configStore.js
const fs = require("fs");
const path = require("path");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

const DEFAULT_CONFIG = {
  url: "https://admin.starwin.plus",
  usernameSuffix: "_starwin",
  fixedPassword: "Hola1234",
  safety: { rateLimitSeconds: 2 },
  welcome: { cooldownSeconds: 30 },
  menu: { 
    welcome: "¡Bienvenido a Starwin! ¿En qué puedo ayudarte?\n\nResponde con: INFORMACION, CREAR USUARIO o ASISTENCIA"
  },
  info: { 
    text: "Somos Starwin, tu plataforma de apuestas deportivas de confianza.\n\n🎯 Apuestas en vivo\n⚽ Deportes variados\n💰 Retiros rápidos\n🎁 Bonos exclusivos\n\n¡Regístrate ahora y obtén tu bono de bienvenida!" 
  },
  support: { 
    text: "📞 Soporte 24/7\n\n¿Necesitas ayuda? Nuestro equipo está disponible para asistirte.\n\nContacta a: soporte@starwin.plus\n\nHorario: Lunes a Domingo, 24 horas" 
  },
  createUser: {
    askName: "Buenas, me dirías tu nombre por favor?",
    invalidName: "❌ Nombre inválido. Debe tener entre 2 y 30 caracteres, solo letras y espacios.",
    creating: "⏳ Creando tu usuario en Starwin...",
    // Etiquetas de cuenta creada (el dato se manda como mensaje aparte, copiable)
    createdUserLabel: "👤 Tu usuario es:",
    createdPassLabel: "🔑 Tu contraseña es:",
    createdUrlLabel: "🌐 Ingresá acá:",
    // Se mantiene por retrocompatibilidad
    createdTemplate: "✅ ¡Tu cuenta ha sido creada!\n\n👤 Usuario: {{username}}\n🔑 Contraseña: {{password}}\n🌐 Sitio: {{url}}\n\n¡Ya puedes ingresar y empezar a jugar!",
    askDeposit: "¿Deseas realizar un depósito ahora? Responde SI o NO",
    depositYes: "💰 Perfecto, un operador se contactará contigo en breve para procesar tu depósito.\n\n¡Gracias por confiar en Starwin!",
    depositNo: "👍 No hay problema. Puedes depositar cuando quieras desde tu cuenta.\n\n¡Nos vemos en el juego!",
    // ✅ NUEVOS: Mensajes configurables v2
    welcomeBackMessage: "¡Hola de nuevo! 👋 Ya tenés tu cuenta creada.\n\nSi querés hacer un depósito escribí *DEPOSITO*\nSi necesitás ayuda escribí *SOPORTE*\nSi necesitás info escribí *INFO*",
    creatingUserWaitMessage: "⏳ Estamos creando tu cuenta, esperá un momento por favor...",
    proofReminderMessage: "⏰ ¡Recordatorio! ¿Ya pudiste hacer la transferencia?\n\nAcordate de mandar la *foto del comprobante* por acá.\nSi necesitás los datos de nuevo escribí *DEPOSITO*",
    proofReminderMinutes: 15
  },
  starwin: {
    baseUrl: "https://admin.starwin.plus",
    domain: "admin.starwin.plus",
    csrfPath: "/api/sanctum/csrf-cookie",
    loginPath: "/api/admin/login",
    createUserPath: "/api/admin/user/register",
    adminUser: "",
    adminPass: "",
    cfClearance: "",
    cfClearanceDomain: ".starwin.plus",
    cfClearancePath: "/",
    cfClearanceUpdated: "",
    cfClearanceExpires: "",
    userType: 13,
    clientId: 40000004,
    currencyId: 8,
    infiniteagent: true
  }
};

class ConfigStore {
  constructor({ basePath, defaultConfig = DEFAULT_CONFIG }) {
    this.basePath = basePath;
    this.dir = path.join(basePath, "config");
    this.file = path.join(this.dir, "bot-config.json");
    this.defaultConfig = defaultConfig;

    ensureDir(this.dir);

    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify(this.defaultConfig, null, 2), "utf-8");
      console.log(`[ConfigStore] Config creada en: ${this.file}`);
    }
  }

  get() {
    try {
      const rawData = fs.readFileSync(this.file, "utf-8");
      const data = JSON.parse(rawData);
      
      // Asegurar estructura completa
      const merged = deepMerge(this.defaultConfig, data);
      
      return merged;
    } catch (e) {
      console.error(`[ConfigStore] ERROR leyendo config:`, e.message);
      return this.defaultConfig;
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
  for (const k of Object.keys(b)) out[k] = deepMerge(out[k], b[k]);
  return out;
}

module.exports = { ConfigStore };