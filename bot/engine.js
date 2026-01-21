// bot/engine.js
class BotEngine {
  constructor({ configStore, sessionStore, userCreator, onSendMessage, onLog }) {
    this.configStore = configStore;
    this.sessionStore = sessionStore;
    this.userCreator = userCreator;
    this.onSendMessage = onSendMessage;
    this.onLog = onLog;
  }

  async handleIncoming({ lineId, from, text, ts }) {
    console.log(`[ENGINE] handleIncoming llamado: lineId=${lineId}, from=${from}, text="${text}"`);
    
    const cfg = this.configStore.get();
    const msg = (text || "").trim();
    if (!msg) {
      console.log(`[ENGINE] Mensaje vacío, retornando`);
      return;
    }

    // crear/obtener sesión
    const session = this.sessionStore.upsert(lineId, from, (s) => s);

    // Chequear si sesión lleva >2 horas sin actividad → resetear
    this.sessionStore.resetIfInactive(lineId, from, 2);
    
    // Obtener sesión actualizada (post-reset si aplica)
    const sessionAfterCheck = this.sessionStore.get(lineId, from);

    // ✅ Normalizar: sin acentos, mayúsculas, espacios extras
    const normalized = msg
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    console.log(`[DEBUG] Mensaje original: "${msg}" -> Normalizado: "${normalized}"`);

    // rate-limit SOLO para mensajes no-comando (spam prevention)
    // NO aplicar rate-limit si estamos esperando input (WAIT_NAME, WAIT_DEPOSIT)
    const isWaitingForInput = sessionAfterCheck.state === "WAIT_NAME" || sessionAfterCheck.state === "WAIT_DEPOSIT";
    
    const isKnownCommand = 
      normalized === "MENU" || 
      normalized === "REINICIAR" || 
      normalized === "CANCELAR" ||
      normalized.includes("INFORMACION") ||
      normalized.includes("ASISTENCIA") ||
      normalized.includes("CREAR USUARIO");
    
    if (!isKnownCommand && !isWaitingForInput && (cfg.safety?.rateLimitSeconds || 0) > 0) {
      const now = Date.now();
      const delta = now - (session.meta.lastActionAt || 0);
      console.log(`[RATELIMIT] delta=${delta}ms, limit=${cfg.safety.rateLimitSeconds * 1000}ms`);
      if (delta < (cfg.safety.rateLimitSeconds * 1000)) {
        console.log(`[RATELIMIT] ¡Bloqueado por rate-limit!`);
        return;
      }
    }

    // comandos globales
    if (normalized === "MENU" || normalized === "REINICIAR" || normalized === "CANCELAR") {
      await this._setState(lineId, from, "MENU");
      await this._sendMenu(lineId, from, cfg, true);
      await this._log("CMD_MENU", { lineId, from });
      return;
    }

    // si estamos esperando nombre, lo procesamos primero
    if (sessionAfterCheck.state === "WAIT_NAME") {
      // Resetear rate-limit para que no bloquee el input del nombre
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

      // guardo nombre
      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.name = msg;
        return s;
      });

      await this._reply(lineId, from, cfg.createUser.creating);
      await this._setState(lineId, from, "CREATING_USER");

      const res = await this.userCreator.create({
        name: msg,
        suffix: cfg.usernameSuffix,
        fixedPassword: cfg.fixedPassword
      });

      if (!res.ok) {
        await this._reply(lineId, from, "Hubo un error al crear el usuario. Proba de nuevo mas tarde.");
        await this._setState(lineId, from, "MENU");
        await this._sendMenu(lineId, from, cfg, true);
        await this._log("CREATE_ERROR", { lineId, from, err: res.error || "unknown" });
        return;
      }

      const out = template(cfg.createUser.createdTemplate, {
        username: res.username,
        password: res.password,
        url: cfg.url
      });

      await this._reply(lineId, from, out);
      await this._log("CREATE_OK", { lineId, from, username: res.username });

      // Ir a WAIT_DEPOSIT para preguntar sobre cargar saldo
      await this._setState(lineId, from, "WAIT_DEPOSIT");
      console.log(`[DEBUG] cfg.createUser.askDeposit = "${cfg.createUser.askDeposit}"`);
      await this._reply(lineId, from, cfg.createUser.askDeposit);
      return;
    }

    // si estamos esperando respuesta sobre deposito
    if (sessionAfterCheck.state === "WAIT_DEPOSIT") {
      // Resetear rate-limit para que no bloquee el input SI/NO
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });

      if (normalized === "SI" || normalized === "SÍ" || normalized === "S") {
        await this._reply(lineId, from, cfg.createUser.depositYes);
        await this._log("DEPOSIT_YES", { lineId, from });
      } else if (normalized === "NO" || normalized === "N") {
        await this._reply(lineId, from, cfg.createUser.depositNo);
        await this._log("DEPOSIT_NO", { lineId, from });
      } else {
        // respuesta inválida, preguntar de nuevo
        await this._reply(lineId, from, cfg.createUser.askDeposit);
        return;
      }
      
      // Marcar sesión como completada
      this.sessionStore.upsert(lineId, from, (s) => {
        s.completed = true;
        s.state = "MENU";
        return s;
      });
      
      return;
    }

    // ✅ OPCIONES DEL MENU - con tolerancia a acentos y variaciones
    // INFO / INFORMACIÓN / INFORMACION / INFO
    if (normalized.includes("INFORMACION") || normalized === "INFO") {
      console.log(`[${lineId}] Usuario pidió INFORMACIÓN`);
      
      // Marcar opción como usada
      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.usedOptions = s.data.usedOptions || {};
        s.data.usedOptions.INFORMACION = true;
        return s;
      });

      await this._reply(lineId, from, cfg.info.text);
      await this._reply(lineId, from, "¿Quieres saber algo mas?");
      
      // Enviar menú dinámico con opciones restantes
      await this._sendDynamicMenu(lineId, from, cfg);
      await this._log("FLOW_INFO", { lineId, from });
      
      // Resetear rate-limit para que no bloquee siguiente comando
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });
      return;
    }

    // ASISTENCIA / AYUDA / SOPORTE
    if (normalized.includes("ASISTENCIA") || normalized.includes("AYUDA") || normalized.includes("SOPORTE")) {
      console.log(`[${lineId}] Usuario pidió ASISTENCIA`);
      
      // Marcar opción como usada
      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.usedOptions = s.data.usedOptions || {};
        s.data.usedOptions.ASISTENCIA = true;
        return s;
      });

      await this._reply(lineId, from, cfg.support.text);
      await this._reply(lineId, from, "¿Quieres saber algo mas?");
      
      // Enviar menú dinámico con opciones restantes
      await this._sendDynamicMenu(lineId, from, cfg);
      await this._log("FLOW_SUPPORT", { lineId, from });
      
      // Resetear rate-limit para que no bloquee siguiente comando
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });
      return;
    }

    // CREAR USUARIO / CREAR / USUARIO
    if (normalized.includes("CREAR USUARIO") || normalized.includes("CREAR") || normalized === "USUARIO") {
      console.log(`[${lineId}] Usuario pidió CREAR USUARIO`);
      
      // Marcar opción como usada
      this.sessionStore.upsert(lineId, from, (s) => {
        s.data = s.data || {};
        s.data.usedOptions = s.data.usedOptions || {};
        s.data.usedOptions.CREAR_USUARIO = true;
        return s;
      });
      
      await this._setState(lineId, from, "WAIT_NAME");
      await this._reply(lineId, from, cfg.createUser.askName);
      await this._log("FLOW_CREATE_START", { lineId, from });
      return;
    }

    // ✅ Si no coincide con nada, mostrar menú de nuevo
    await this._sendMenu(lineId, from, cfg);
    await this._log("WELCOME_SENT", { lineId, from, text: msg });
  }

  async _sendMenu(lineId, to, cfg, force = false) {
    const cooldown = Number(cfg.welcome?.cooldownSeconds || 0);

    // si hay cooldown y no es force, chequeo último envío
    if (!force && cooldown > 0) {
      const s = this.sessionStore.get(lineId, to);
      const last = s?.meta?.lastWelcomeAt || 0;
      const now = Date.now();
      if (now - last < cooldown * 1000) {
        console.log(`[${lineId}] Menu cooldown activo, saltando`);
        return;
      }
    }

    const menuText =
      `${cfg.menu.welcome}\n\n` +
      `Responde con: INFORMACION, CREAR USUARIO o ASISTENCIA`;

    console.log(`[${lineId}] Enviando menu a ${to}`);

    // guardo timestamp de bienvenida
    this.sessionStore.upsert(lineId, to, (s) => {
      s.meta.lastWelcomeAt = Date.now();
      // si no está en un estado, lo pongo en MENU
      if (!s.state) s.state = "MENU";
      return s;
    });

    await this._reply(lineId, to, menuText);
  }

  async _reply(lineId, to, text) {
    this.sessionStore.upsert(lineId, to, (s) => {
      s.meta.lastActionAt = Date.now();
      return s;
    });

    await this._log("SEND_ATTEMPT", { lineId, to, preview: String(text).slice(0, 60) });

    const res = await this.onSendMessage({ lineId, to, text });

    if (res?.ok) {
      await this._log("SEND_OK", { lineId, to, used: res.used || to, fallback: !!res.fallback });
    } else {
      await this._log("SEND_FAIL", { lineId, to, error: res?.error || "unknown" });
    }
  }

  async _setState(lineId, chatId, state) {
    this.sessionStore.upsert(lineId, chatId, (s) => {
      s.state = state;
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
    this.onLog?.({ at: new Date().toISOString(), type, ...payload });
  }

  async _sendDynamicMenu(lineId, to, cfg) {
    // Obtener sesión para ver qué opciones ya se usaron
    const session = this.sessionStore.get(lineId, to);
    const usedOptions = session?.data?.usedOptions || {};

    // Construir lista de opciones disponibles
    const availableOptions = [];
    if (!usedOptions.INFORMACION) availableOptions.push("INFORMACION");
    if (!usedOptions.ASISTENCIA) availableOptions.push("ASISTENCIA");
    if (!usedOptions.CREAR_USUARIO) availableOptions.push("CREAR USUARIO");

    // Si no hay opciones disponibles, mostrar todas de nuevo
    const options = availableOptions.length > 0 ? availableOptions : ["INFORMACION", "ASISTENCIA", "CREAR USUARIO"];

    const menuText = `Responde con: ${options.join(", ")}`;

    console.log(`[${lineId}] Enviando menú dinámico a ${to}: ${options.join(", ")}`);

    await this._reply(lineId, to, menuText);
  }
}

function template(str, vars) {
  return String(str || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ""));
}

function isValidName(name) {
  if (!name) return false;
  if (name.length < 2 || name.length > 30) return false;
  return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/.test(name);
}

module.exports = { BotEngine };
