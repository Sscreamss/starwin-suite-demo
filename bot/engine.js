// bot/engine.js
class BotEngine {
  constructor({ configStore, sessionStore, userCreator, cfMaintainer, sheetsLogger, onSendMessage, onLog }) {
    this.configStore = configStore;
    this.sessionStore = sessionStore;
    this.userCreator = userCreator;
    this.cfMaintainer = cfMaintainer;
    this.sheetsLogger = sheetsLogger; // ← AGREGADO PARA SHEETS
    this.onSendMessage = onSendMessage;
    this.onLog = onLog;
  }

  // ✅ Ahora recibe metadata del mensaje (type/hasMedia/mimetype) para manejar WAIT_PROOF con fotos
  async handleIncoming({ lineId, from, text, ts, type = "chat", hasMedia = false, mimetype = null }) {
    console.log(
      `[ENGINE] handleIncoming: lineId=${lineId}, from=${from}, text="${text}", type=${type}, hasMedia=${hasMedia}, mimetype=${mimetype}`
    );

    // Primero verificar estado de Cloudflare
    const cfStatus = this.cfMaintainer.getStatus();
    if (cfStatus.needsRenewal && cfStatus.priority === "HIGH") {
      this._log("CF_STATUS_WARNING", {
        lineId,
        from,
        status: cfStatus.status,
        reason: cfStatus.reason,
        message: "Cloudflare necesita renovación urgente"
      });
    }

    const cfg = this.configStore.get();
    const cu = cfg.createUser || {};

    // ✅ Defaults (por si todavía no existen en config)
    const DEFAULTS = {
      bankDetailsMessage:
        "Perfecto! Te paso los datos bancarios:\n" +
        "👤 TITULAR: Angelica Vanesa Mendoza\n" +
        "ALIAS: muguet.pausado.lemon\n" +
        "⬇️⬇️⬇️",
      cbuMessage: "0000168300000024246152",
      askProofMessage: "📸 Ahora enviá por acá la *foto del comprobante*.",
      proofRedirectMessage:
        "Estas listo para comenzar! 🥳\n" +
        "Ahora te derivo con nuestra línea de caja principal para acreditar tu carga.\n" +
        "Hacé clic en el número para comunicarte por WhatsApp:\n" +
        "⬇️⬇️⬇️\n\n" +
        "+54 9 11 7133-2551\n\n" +
        "Por favor, enviá por ese medio:\n" +
        "-Tu nombre de usuario\n" +
        "-El comprobante de pago\n" +
        "-El nombre del titular de la cuenta\n" +
        "¡Gracias y muchísima suerte!",
      depositNoMessage:
        "👍 No hay problema. Puedes depositar cuando quieras desde tu cuenta.\n\n" +
        "¡Nos vemos en el juego!\n\n" +
        "Para mandar tu primera carga escribí: Deposito"
    };

    // ✅ Textos editables desde config
    const bankMsg = (cu.bankDetailsMessage || DEFAULTS.bankDetailsMessage).trim();
    const cbuMsg = (cu.cbuMessage || DEFAULTS.cbuMessage).trim();
    const askProofMsg = (cu.askProofMessage || DEFAULTS.askProofMessage).trim();
    const proofRedirectMsg = (cu.proofRedirectMessage || DEFAULTS.proofRedirectMessage).trim();
    const depositNoMsg = (
      cu.depositNoMessage ||
      cu.depositNo ||
      DEFAULTS.depositNoMessage
    ).trim();

    const msg = (text || "").trim();

    // ✅ Detectar imagen (foto o archivo imagen enviado como documento)
    const isImage =
      type === "image" ||
      (hasMedia && typeof mimetype === "string" && mimetype.toLowerCase().startsWith("image/"));

    // Asegurar sesión y reset inactividad (también para fotos)
    this.sessionStore.upsert(lineId, from, (s) => s);
    this.sessionStore.resetIfInactive(lineId, from, 2);
    const sessionAfterCheck = this.sessionStore.get(lineId, from);

    // ✅ Opción B: estado dedicado a esperar comprobante
    if (sessionAfterCheck.state === "WAIT_PROOF") {
      // Evitar rate limit en este estado (es input esperado)
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });

      if (isImage) {
        await this._reply(lineId, from, proofRedirectMsg);

        await this._log("PROOF_IMAGE_RECEIVED", {
          lineId,
          from,
          type,
          hasMedia,
          mimetype,
          message: "Comprobante recibido (imagen). Derivación enviada."
        });

        // Cerrar flujo
        this.sessionStore.upsert(lineId, from, (s) => {
          s.completed = true;
          s.state = "MENU";
          s.data = s.data || {};
          s.data.proofReceived = true;
          s.data.completedAt = Date.now();
          return s;
        });

        return;
      }

      // Si mandó texto u otra cosa, pedir foto
      if (!msg) {
        await this._reply(lineId, from, "📸 Por favor, enviá el comprobante como *foto* por acá.");
        return;
      }

      // Si escribe "deposito" acá, no reenviar datos: ya está en prueba
      const normalizedInProof = normalizeText(msg);
      if (isIntent(normalizedInProof, "DEPOSITO")) {
        await this._reply(lineId, from, "📸 Ya te pasé los datos. Ahora enviá la *foto del comprobante* por acá.");
        return;
      }

      await this._reply(lineId, from, "📸 Por favor, enviá el comprobante como *foto* (no en texto).");
      await this._log("PROOF_EXPECTED_IMAGE", {
        lineId,
        from,
        text: msg.substring(0, 80)
      });
      return;
    }

    // ✅ Fuera de WAIT_PROOF: si no hay texto, no procesamos (ignoramos fotos en otros estados)
    if (!msg) return;

    const normalized = normalizeText(msg);

    const isWaitingForInput =
      sessionAfterCheck.state === "WAIT_NAME" ||
      sessionAfterCheck.state === "WAIT_DEPOSIT" ||
      sessionAfterCheck.state === "WAIT_PROOF";

    const isKnownCommand =
      isIntent(normalized, "MENU") ||
      isIntent(normalized, "REINICIAR") ||
      isIntent(normalized, "CANCELAR") ||
      isIntent(normalized, "INFO") ||
      isIntent(normalized, "SOPORTE") ||
      isIntent(normalized, "CREAR_USUARIO") ||
      isIntent(normalized, "DEPOSITO");

    if (!isKnownCommand && !isWaitingForInput && (cfg.safety?.rateLimitSeconds || 0) > 0) {
      const now = Date.now();
      const delta = now - (sessionAfterCheck.meta.lastActionAt || 0);
      if (delta < cfg.safety.rateLimitSeconds * 1000) return;
    }

    // ✅ MENU / REINICIAR / CANCELAR
    if (isIntent(normalized, "MENU") || isIntent(normalized, "REINICIAR") || isIntent(normalized, "CANCELAR")) {
      await this._setState(lineId, from, "MENU");
      await this._sendMenu(lineId, from, cfg, true);
      await this._log("CMD_MENU", { lineId, from, text: normalized });
      return;
    }

    // ✅ Comando DEPOSITO (desde menú o cualquier estado que no sea WAIT_NAME)
    if (isIntent(normalized, "DEPOSITO")) {
      if (sessionAfterCheck.state === "WAIT_NAME") {
        // Si está pidiendo nombre, no interrumpimos
        await this._reply(lineId, from, cfg.createUser.askName);
        return;
      }

      // ✅ Mensajes desde config
      await this._reply(lineId, from, bankMsg);
      await this._reply(lineId, from, cbuMsg);

      // Pasar a WAIT_PROOF para esperar comprobante (foto)
      this.sessionStore.upsert(lineId, from, (s) => {
        s.completed = false;
        s.state = "WAIT_PROOF";
        s.data = s.data || {};
        s.data.depositResponse = "SI";
        s.data.waitingProofSince = Date.now();
        return s;
      });

      await this._reply(lineId, from, askProofMsg);

      await this._log("DEPOSIT_COMMAND", {
        lineId,
        from,
        message: "Intent DEPOSITO detectado: envío datos + CBU y espero comprobante",
        text: normalized
      });

      // ✅ ACTUALIZAR DEPÓSITO EN SHEETS
      if (this.sheetsLogger) {
        try {
          await this.sheetsLogger.updateDeposit(from, true);
        } catch (error) {
          this._log("SHEETS_UPDATE_ERROR", {
            lineId,
            from,
            error: error.message
          });
        }
      }

      return;
    }

    // ✅ WAIT_NAME
    if (sessionAfterCheck.state === "WAIT_NAME") {
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });

      if (!isValidName(msg)) {
        await this._bumpAttempts(lineId, from);
        await this._reply(lineId, from, cfg.createUser.invalidName);
        await this._log("NAME_INVALID", { lineId, from, text: msg });
        return;
      }

      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.name = msg;
        s.data.timestamp = Date.now();
        return s;
      });

      await this._reply(lineId, from, cfg.createUser.creating);
      await this._setState(lineId, from, "CREATING_USER");

      // Verificar Cloudflare antes de intentar crear usuario
      const cfCheck = this.cfMaintainer.checkAndRenewIfNeeded();
      if (cfCheck.needsRenewal && cfCheck.priority === "HIGH") {
        await this._reply(lineId, from, "⚠️ El sistema está en mantenimiento. Por favor, intentá de nuevo en unos minutos.");
        await this._log("CF_BLOCKED_CREATE", {
          lineId,
          from,
          reason: cfCheck.reason,
          message: "Bloqueado por Cloudflare, necesita renovación urgente"
        });
        await this._setState(lineId, from, "MENU");
        await this._sendMenu(lineId, from, cfg, true);
        return;
      }

      const res = await this.userCreator.create({
        name: msg,
        suffix: cfg.usernameSuffix,
        fixedPassword: cfg.fixedPassword
      });

      if (!res.ok) {
        let userMessage = "Hubo un error al crear el usuario. Probá de nuevo más tarde.";
        const errorStr = String(res.error || "");

        if (res.needRenewCfClearance) {
          userMessage = "⚠️ El sistema está en mantenimiento. Por favor, intentá de nuevo en unos minutos.";
          await this._log("CF_NEED_RENEW_CREATE", {
            lineId,
            from,
            hint: "Renovar Cloudflare automáticamente",
            action: "AUTO_RENEW_TRIGGERED",
            retryCount: res.retryCount || 0
          });
        } else if (errorStr === "Faltan credenciales admin en config") {
          userMessage = "❌ Error de configuración. Contactá al administrador.";
        } else if (errorStr.includes("CF_MAX_RETRIES_EXCEEDED")) {
          userMessage = "⏳ Sistema ocupado. Por favor, intentá más tarde.";
        } else if (errorStr.includes("CF_BLOCKED")) {
          userMessage = "🔒 Problema de seguridad detectado. Intenta nuevamente en un momento.";
        } else if (res.status === 401) {
          userMessage = "❌ Error de autenticación. Las credenciales de admin son incorrectas.";
        }

        await this._reply(lineId, from, userMessage);
        await this._log("CREATE_ERROR", {
          lineId,
          from,
          needRenewCfClearance: !!res.needRenewCfClearance,
          status: res.status,
          code: res.code,
          error: res.error,
          data: res.data ? String(res.data).substring(0, 100) : null
        });

        await this._setState(lineId, from, "MENU");
        await this._sendMenu(lineId, from, cfg, true);
        return;
      }

      const out = template(cfg.createUser.createdTemplate, {
        username: res.username,
        email: res.email || `${res.username}@admin.starwin.plus`,
        password: res.password,
        url: cfg.url
      });

      await this._reply(lineId, from, out);
      await this._log("CREATE_OK", {
        lineId,
        from,
        username: res.username,
        email: res.email,
        message: "Usuario creado exitosamente"
      });

      // ✅ GUARDAR USUARIO EN GOOGLE SHEETS
      if (this.sheetsLogger) {
        const session = this.sessionStore.get(lineId, from);
        const nombreUsuario = session?.data?.name || "Desconocido";

        try {
          await this.sheetsLogger.logUser({
            nombre: nombreUsuario,
            telefono: from,
            usuario: res.username,
            password: res.password,
            linea: lineId,
            deposito: false
          });

          this._log("SHEETS_SAVED", {
            lineId,
            from,
            username: res.username,
            message: "Usuario guardado en Google Sheets"
          });
        } catch (error) {
          this._log("SHEETS_ERROR", {
            lineId,
            from,
            error: error.message,
            message: "Error guardando en Google Sheets (no crítico)"
          });
        }
      }

      await this._setState(lineId, from, "WAIT_DEPOSIT");
      await this._reply(lineId, from, cfg.createUser.askDeposit);
      return;
    }

    // ✅ WAIT_DEPOSIT
    if (sessionAfterCheck.state === "WAIT_DEPOSIT") {
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });

      const response = normalized;

      if (isIntent(response, "YES")) {
        // ✅ Mensajes desde config
        await this._reply(lineId, from, bankMsg);
        await this._reply(lineId, from, cbuMsg);

        this.sessionStore.upsert(lineId, from, (s) => {
          s.completed = false;
          s.state = "WAIT_PROOF";
          s.data = s.data || {};
          s.data.depositResponse = "SI";
          s.data.waitingProofSince = Date.now();
          return s;
        });

        await this._reply(lineId, from, askProofMsg);

        await this._log("DEPOSIT_YES", {
          lineId,
          from,
          message: "Usuario quiere depositar (envío datos + CBU, esperando comprobante)"
        });

        if (this.sheetsLogger) {
          try {
            await this.sheetsLogger.updateDeposit(from, true);
          } catch (error) {
            this._log("SHEETS_UPDATE_ERROR", { lineId, from, error: error.message });
          }
        }

        return;
      }

      if (isIntent(response, "NO")) {
        // ✅ Mensaje desde config
        await this._reply(lineId, from, depositNoMsg);

        await this._log("DEPOSIT_NO", {
          lineId,
          from,
          message: "Usuario no quiere depositar (se informa comando DEPOSITO)"
        });

        if (this.sheetsLogger) {
          try {
            await this.sheetsLogger.updateDeposit(from, false);
          } catch (error) {
            this._log("SHEETS_UPDATE_ERROR", { lineId, from, error: error.message });
          }
        }

        this.sessionStore.upsert(lineId, from, (s) => {
          s.completed = true;
          s.state = "MENU";
          s.data = s.data || {};
          s.data.depositResponse = "NO";
          s.data.completedAt = Date.now();
          return s;
        });

        await this._sendMenu(lineId, from, cfg, true);
        return;
      }

      // Si no fue una respuesta válida, repetir pregunta
      await this._reply(lineId, from, cfg.createUser.askDeposit);
      return;
    }

    // ✅ INFO
    if (isIntent(normalized, "INFO")) {
      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.usedOptions = s.data.usedOptions || {};
        s.data.usedOptions.INFORMACION = true;
        s.data.lastInfoRequest = Date.now();
        return s;
      });

      await this._reply(lineId, from, cfg.info.text);
      await this._reply(lineId, from, "\n¿Querés saber algo más?");
      await this._sendDynamicMenu(lineId, from, cfg);
      await this._log("FLOW_INFO", { lineId, from, message: "Información solicitada" });

      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });
      return;
    }

    // ✅ SOPORTE
    if (isIntent(normalized, "SOPORTE")) {
      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.usedOptions = s.data.usedOptions || {};
        s.data.usedOptions.ASISTENCIA = true;
        s.data.lastSupportRequest = Date.now();
        return s;
      });

      await this._reply(lineId, from, cfg.support.text);
      await this._reply(lineId, from, "\n¿Querés saber algo más?");
      await this._sendDynamicMenu(lineId, from, cfg);
      await this._log("FLOW_SUPPORT", { lineId, from, message: "Soporte solicitado" });

      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });
      return;
    }

    // ✅ CREAR USUARIO
    if (isIntent(normalized, "CREAR_USUARIO")) {
      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.usedOptions = s.data.usedOptions || {};
        s.data.usedOptions.CREAR_USUARIO = true;
        s.data.creationRequests = (s.data.creationRequests || 0) + 1;
        return s;
      });

      await this._setState(lineId, from, "WAIT_NAME");
      await this._reply(lineId, from, cfg.createUser.askName);
      await this._log("FLOW_CREATE_START", { lineId, from, message: "Iniciando creación de usuario" });
      return;
    }

    // Si no es un comando conocido, enviar menú
    await this._sendMenu(lineId, from, cfg);
    await this._log("WELCOME_SENT", {
      lineId,
      from,
      text: msg.substring(0, 50),
      message: "Mensaje no reconocido, enviando menú"
    });
  }

  async _sendMenu(lineId, to, cfg, force = false) {
    const cooldown = Number(cfg.welcome?.cooldownSeconds || 0);

    if (!force && cooldown > 0) {
      const s = this.sessionStore.get(lineId, to);
      const last = s?.meta?.lastWelcomeAt || 0;
      const now = Date.now();
      if (now - last < cooldown * 1000) return;
    }

    const menuText = cfg.menu.welcome;

    this.sessionStore.upsert(lineId, to, (s) => {
      s.meta.lastWelcomeAt = Date.now();
      if (!s.state) s.state = "MENU";
      return s;
    });

    await this._reply(lineId, to, menuText);
  }

  async _reply(lineId, to, text) {
    this.sessionStore.upsert(lineId, to, (s) => {
      s.meta.lastActionAt = Date.now();
      s.meta.messageCount = (s.meta.messageCount || 0) + 1;
      return s;
    });

    await this._log("SEND_ATTEMPT", {
      lineId,
      to,
      preview: String(text).slice(0, 80),
      length: text.length,
      timestamp: Date.now()
    });

    const res = await this.onSendMessage({ lineId, to, text });

    if (res?.ok) {
      await this._log("SEND_OK", {
        lineId,
        to,
        used: res.used || to,
        fallback: !!res.fallback,
        message: "Mensaje enviado exitosamente",
        timestamp: Date.now()
      });
    } else {
      await this._log("SEND_FAIL", {
        lineId,
        to,
        error: res?.error || "unknown",
        message: "Error enviando mensaje",
        timestamp: Date.now()
      });
    }
  }

  async _setState(lineId, chatId, state) {
    this.sessionStore.upsert(lineId, chatId, (s) => {
      const prev = s.state;
      s.state = state;
      s.meta.lastStateChange = Date.now();
      s.meta.previousState = prev; // ✅ estado anterior real
      return s;
    });
  }

  async _bumpAttempts(lineId, chatId) {
    this.sessionStore.upsert(lineId, chatId, (s) => {
      s.meta.attempts = (s.meta.attempts || 0) + 1;
      return s;
    });
  }

  async _log(type, payload) {
    this.onLog?.({
      at: new Date().toISOString(),
      type,
      ...payload
    });
  }

  async _sendDynamicMenu(lineId, to, cfg) {
    const session = this.sessionStore.get(lineId, to);
    const usedOptions = session?.data?.usedOptions || {};

    const availableOptions = [];
    if (!usedOptions.INFORMACION) availableOptions.push("INFORMACION");
    if (!usedOptions.ASISTENCIA) availableOptions.push("ASISTENCIA");
    if (!usedOptions.CREAR_USUARIO) availableOptions.push("CREAR USUARIO");

    const options = availableOptions.length > 0 ? availableOptions : ["INFORMACION", "ASISTENCIA", "CREAR USUARIO"];
    await this._reply(lineId, to, `Responde con: ${options.join(", ")}`);
  }

  async getSystemStatus() {
    const cfStatus = this.cfMaintainer.getStatus();
    const sessionCount = this.sessionStore.count();
    const activeSessions = Object.values(this.sessionStore.cache).filter(
      (s) => s.meta && Date.now() - s.meta.lastActionAt < 3600000
    ).length;

    return {
      cloudflare: {
        ...cfStatus,
        isValid: !cfStatus.needsRenewal,
        hasCookie: cfStatus.hasCookie,
        lastUpdated: cfStatus.lastUpdated
      },
      sessions: {
        total: sessionCount,
        active: activeSessions,
        inactive: sessionCount - activeSessions
      },
      userCreator: {
        cfRetryCount: this.userCreator.cfRetryCount,
        maxCfRetries: this.userCreator.maxCfRetries,
        status: this.userCreator.cfRetryCount > 0 ? "RETRYING" : "READY"
      },
      engine: {
        timestamp: new Date().toISOString(),
        status: "RUNNING"
      }
    };
  }

  async cleanupOldSessions(hours = 24) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [key, session] of Object.entries(this.sessionStore.cache)) {
      const lastAction = session.meta?.lastActionAt || 0;
      if (lastAction < cutoff) {
        delete this.sessionStore.cache[key];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.sessionStore._writeAll();
      this._log("CLEANUP", {
        message: `Sesiones limpiadas: ${cleaned}`,
        hours: hours,
        remaining: Object.keys(this.sessionStore.cache).length
      });
    }

    return cleaned;
  }
}

/* ---------------------------
   Intents / Variantes comandos
---------------------------- */

function normalizeText(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * - exact: debe ser exactamente ese valor (normalizado)
 * - contains: alcanza con que el mensaje contenga esa frase (normalizada)
 */
const INTENTS = {
  MENU: {
    exact: ["MENU", "MENÚ", "INICIO", "START", "HOME"],
    contains: ["VOLVER AL MENU", "IR AL MENU", "MOSTRAR MENU", "MENU PRINCIPAL", "VOLVER AL INICIO"]
  },
  REINICIAR: {
    exact: ["REINICIAR", "RESET", "RESETAR", "RESTART"],
    contains: ["REINICIA", "REINICIAME", "RESET BOT", "REINICIAR BOT", "VOLVER A EMPEZAR"]
  },
  CANCELAR: {
    exact: ["CANCELAR", "CANCEL", "SALIR"],
    contains: ["CANCELA", "CANCELAME", "SALIR DEL BOT", "SALIR DE ACA", "NO QUIERO SEGUIR"]
  },
  INFO: {
    exact: ["INFO", "INFORMACION", "INFORMACIÓN", "DATOS"],
    contains: ["QUIERO INFO", "NECESITO INFO", "MAS INFO", "MÁS INFO", "QUIERO INFORMACION", "QUIERO INFORMACIÓN"]
  },
  SOPORTE: {
    exact: ["SOPORTE", "AYUDA", "ASISTENCIA", "HELP"],
    contains: ["NECESITO AYUDA", "NECESITO SOPORTE", "QUIERO AYUDA", "TENGO UN PROBLEMA", "NO PUEDO"]
  },
  CREAR_USUARIO: {
    exact: ["CREAR", "USUARIO", "CREAR USUARIO", "NUEVO USUARIO"],
    contains: ["QUIERO CREAR", "QUIERO UN USUARIO", "CREAME UN USUARIO", "GENERAR USUARIO", "HACER USUARIO"]
  },
  DEPOSITO: {
    exact: ["DEPOSITO", "DEPÓSITO", "CARGA", "CARGAR"],
    contains: ["QUIERO DEPOSITAR", "QUIERO HACER UN DEPOSITO", "HACER DEPOSITO", "HACER CARGA", "CARGAR SALDO", "MANDAR CARGA"]
  },
  YES: {
    exact: ["SI", "SÍ", "S", "DALE", "OK", "OKAY", "VAMOS", "DE UNA"],
    contains: ["OBVIO", "CLARO", "POR SUPUESTO", "METELE", "Metele", "DALE QUE SI"]
  },
  NO: {
    exact: ["NO", "N", "NOP", "NOPE"],
    contains: ["NEGATIVO", "AHORA NO", "MAS TARDE", "DESPUES", "DESPUÉS", "NO QUIERO"]
  }
};

function isIntent(normalized, intentKey) {
  const i = INTENTS[intentKey];
  if (!i) return false;

  if (i.exact?.some((x) => normalizeText(x) === normalized)) return true;
  if (i.contains?.some((x) => normalized.includes(normalizeText(x)))) return true;

  return false;
}

/* ---------------------------
   Helpers existentes
---------------------------- */

function template(str, vars) {
  return String(str || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ""));
}

function isValidName(name) {
  if (!name) return false;
  if (name.length < 2 || name.length > 50) return false;
  return /^[A-Za-zÀÁÉÍÓÚÜÑàáéíóúüñ\s]+$/.test(name);
}

module.exports = { BotEngine };
