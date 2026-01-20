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
    const cfg = this.configStore.get();
    const msg = (text || "").trim();
    if (!msg) return;

    // crear/obtener sesión (ya no filtramos "solo nuevos")
    const session = this.sessionStore.upsert(lineId, from, (s) => s);

    // rate-limit global opcional (para no contestar cada milisegundo)
    if ((cfg.safety?.rateLimitSeconds || 0) > 0) {
      const now = Date.now();
      const delta = now - (session.meta.lastActionAt || 0);
      if (delta < (cfg.safety.rateLimitSeconds * 1000)) return;
    }

    const upper = msg.toUpperCase();

    // comandos globales
    if (upper === "MENU" || upper === "REINICIAR" || upper === "CANCELAR") {
      await this._setState(lineId, from, "MENU");
      await this._sendMenu(lineId, from, cfg, true);
      await this._log("CMD_MENU", { lineId, from });
      return;
    }

    // si estamos esperando nombre, lo procesamos primero
    if (session.state === "WAIT_NAME") {
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
        await this._reply(lineId, from, "Hubo un error al crear el usuario. Probá de nuevo más tarde.");
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

      await this._setState(lineId, from, "MENU");
      await this._sendMenu(lineId, from, cfg, true);
      return;
    }

    // estado MENU o cualquier otro: interpretamos opciones
    if (upper === "INFORMACIÓN" || upper === "INFORMACION" || upper === "INFO") {
      await this._reply(lineId, from, cfg.info.text);
      await this._log("FLOW_INFO", { lineId, from });
      // luego re-muestro menú (opcional)
      await this._sendMenu(lineId, from, cfg);
      return;
    }

    if (upper === "ASISTENCIA" || upper === "AYUDA" || upper === "SOPORTE") {
      await this._reply(lineId, from, cfg.support.text);
      await this._log("FLOW_SUPPORT", { lineId, from });
      await this._sendMenu(lineId, from, cfg);
      return;
    }

    if (upper === "CREAR USUARIO" || upper === "CREAR" || upper === "USUARIO") {
      await this._setState(lineId, from, "WAIT_NAME");
      await this._reply(lineId, from, cfg.createUser.askName);
      await this._log("FLOW_CREATE_START", { lineId, from });
      return;
    }

    // ✅ clave: Bienvenida/menú SIEMPRE ante cualquier mensaje (con cooldown)
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
      if (now - last < cooldown * 1000) return;
    }

    const menuText =
      `${cfg.menu.welcome}\n\n` +
      `Responde con:\n` +
      `- INFORMACIÓN\n- CREAR USUARIO\n- ASISTENCIA`;

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
