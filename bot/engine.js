// bot/engine.js
class BotEngine {
  constructor({ configStore, sessionStore, userCreator, cfMaintainer, sheetsLogger, onSendMessage, onSendImage, onLog }) {
    this.configStore = configStore;
    this.sessionStore = sessionStore;
    this.userCreator = userCreator;
    this.cfMaintainer = cfMaintainer;
    this.sheetsLogger = sheetsLogger;
    this.onSendMessage = onSendMessage;
    this.onSendImage = onSendImage;
    this.onLog = onLog;

    // ✅ NUEVO: Map de timers de recordatorio de comprobante
    this._proofReminders = new Map();
  }

  // ✅ Recibe metadata del mensaje (type/hasMedia/mimetype) para manejar WAIT_PROOF con fotos
  async handleIncoming({ lineId, from, phoneNumber, text, ts, type = "chat", hasMedia = false, mimetype = null }) {
    try {
    console.log(
      `[ENGINE] handleIncoming: lineId=${lineId}, from=${from}, phone=${phoneNumber || "?"}, text="${text}", type=${type}, hasMedia=${hasMedia}, mimetype=${mimetype}`
    );

    // ✅ Número limpio para Sheets (sin @c.us / @lid / @s.whatsapp.net)
    const cleanPhone = phoneNumber || from.replace(/@.+$/, "");

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
        "Para mandar tu primera carga escribí: Deposito",
      createdUserLabel: "👤 Tu usuario es:",
      createdPassLabel: "🔑 Tu contraseña es:",
      createdUrlLabel: "🌐 Ingresá acá:",
      // ✅ NUEVOS DEFAULTS
      welcomeBackMessage:
        "¡Hola de nuevo! 👋 Ya tenés tu cuenta creada.\n\n" +
        "Si querés hacer un depósito escribí *DEPOSITO*\n" +
        "Si necesitás ayuda escribí *SOPORTE*\n" +
        "Si necesitás info escribí *INFO*",
      creatingUserWaitMessage: "⏳ Estamos creando tu cuenta, esperá un momento por favor...",
      proofReminderMessage:
        "⏰ ¡Recordatorio! ¿Ya pudiste hacer la transferencia?\n\n" +
        "Acordate de mandar la *foto del comprobante* por acá.\n" +
        "Si necesitás los datos de nuevo escribí *DEPOSITO*",
      proofReminderMinutes: 15,
      // ✅ NUEVO: Mensajes para usuarios que ya existen en el sheet
      returningUserMessage:
        "¡Hola {nombre}! 👋 Qué bueno verte de nuevo.\n\n" +
        "¿En qué puedo ayudarte?\n\n" +
        "📌 Escribí *DEPOSITO* para cargar saldo\n" +
        "📌 Escribí *OLVIDE MI USUARIO* si no recordás tus datos\n" +
        "📌 Escribí *SOPORTE* si necesitás ayuda\n" +
        "📌 Escribí *INFO* para más información",
      forgotUserMessage:
        "📋 Acá están tus datos:\n\n" +
        "👤 Tu usuario es:",
      userNotFoundMessage:
        "🔍 No encontré una cuenta asociada a tu número.\n" +
        "¿Querés que te cree una? Escribí tu nombre para empezar."
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
    // Etiquetas de cuenta creada
    const createdUserLabel = (cu.createdUserLabel || DEFAULTS.createdUserLabel).trim();
    const createdPassLabel = (cu.createdPassLabel || DEFAULTS.createdPassLabel).trim();
    const createdUrlLabel = (cu.createdUrlLabel || DEFAULTS.createdUrlLabel).trim();

    // ✅ NUEVOS textos configurables
    const welcomeBackMsg = (cu.welcomeBackMessage || DEFAULTS.welcomeBackMessage).trim();
    const creatingUserWaitMsg = (cu.creatingUserWaitMessage || DEFAULTS.creatingUserWaitMessage).trim();
    const proofReminderMsg = (cu.proofReminderMessage || DEFAULTS.proofReminderMessage).trim();
    const proofReminderMinutes = cu.proofReminderMinutes ?? DEFAULTS.proofReminderMinutes;

    // ✅ NUEVO: Textos para usuario que vuelve / olvidó datos
    const returningUserMsg = (cu.returningUserMessage || DEFAULTS.returningUserMessage).trim();
    const forgotUserMsg = (cu.forgotUserMessage || DEFAULTS.forgotUserMessage).trim();
    const userNotFoundMsg = (cu.userNotFoundMessage || DEFAULTS.userNotFoundMessage).trim();

    // Ruta de imagen de depósito
    const depositImagePath = cu.depositImagePath || "";

    const msg = (text || "").trim();

    // ✅ Detectar imagen (foto o archivo imagen enviado como documento)
    const isImage =
      type === "image" ||
      (hasMedia && typeof mimetype === "string" && mimetype.toLowerCase().startsWith("image/"));

    // Asegurar sesión y reset inactividad (también para fotos)
    this.sessionStore.upsert(lineId, from, (s) => s);
    this.sessionStore.resetIfInactive(lineId, from, 2);
    const sessionAfterCheck = this.sessionStore.get(lineId, from);

    // ═══════════════════════════════════════
    // ✅ GUARD: Estado CREATING_USER
    // Si se está creando la cuenta, no procesar nada más
    // ═══════════════════════════════════════
    if (sessionAfterCheck.state === "CREATING_USER") {
      await this._reply(lineId, from, creatingUserWaitMsg);
      await this._log("CREATING_USER_WAIT", {
        lineId,
        from,
        text: msg.substring(0, 50),
        message: "Usuario mandó mensaje mientras se crea la cuenta"
      });
      return;
    }

    // ═══════════════════════════════════════
    // ✅ Estado WAIT_PROOF: esperar comprobante (foto)
    // ═══════════════════════════════════════
    if (sessionAfterCheck.state === "WAIT_PROOF") {
      // Evitar rate limit en este estado (es input esperado)
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });

      if (isImage) {
        // ✅ Cancelar timer de recordatorio
        this._cancelProofReminder(lineId, from);

        await this._reply(lineId, from, proofRedirectMsg);

        await this._log("PROOF_IMAGE_RECEIVED", {
          lineId,
          from,
          type,
          hasMedia,
          mimetype,
          message: "Comprobante recibido (imagen). Derivación enviada."
        });

        // Cerrar flujo — estado COMPLETED, no manda nada más
        this.sessionStore.upsert(lineId, from, (s) => {
          s.completed = true;
          s.state = "COMPLETED";
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

      // ✅ FIX: Permitir comandos que sacan del estado WAIT_PROOF
      if (isIntent(normalizedInProof, "MENU") || isIntent(normalizedInProof, "REINICIAR") || isIntent(normalizedInProof, "CANCELAR")) {
        this._cancelProofReminder(lineId, from);
        this.sessionStore.upsert(lineId, from, (s) => {
          s.completed = false;
          return s;
        });
        await this._setState(lineId, from, "WAIT_NAME");
        await this._reply(lineId, from, cfg.createUser.askName);
        await this._log("PROOF_CMD_RESTART", { lineId, from, text: normalizedInProof });
        return;
      }

      if (isIntent(normalizedInProof, "INFO")) {
        this._cancelProofReminder(lineId, from);
        await this._reply(lineId, from, cfg.info.text);
        await this._log("PROOF_CMD_INFO", { lineId, from });
        return;
      }

      if (isIntent(normalizedInProof, "SOPORTE")) {
        this._cancelProofReminder(lineId, from);
        await this._reply(lineId, from, cfg.support.text);
        await this._log("PROOF_CMD_SOPORTE", { lineId, from });
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
      isIntent(normalized, "DEPOSITO") ||
      isIntent(normalized, "OLVIDE_USUARIO");

    if (!isKnownCommand && !isWaitingForInput && (cfg.safety?.rateLimitSeconds || 0) > 0) {
      const now = Date.now();
      const delta = now - (sessionAfterCheck.meta.lastActionAt || 0);
      if (delta < cfg.safety.rateLimitSeconds * 1000) return;
    }

    // ═══════════════════════════════════════
    // COMANDOS GLOBALES (funcionan desde cualquier estado)
    // ═══════════════════════════════════════

    // ✅ MENU / REINICIAR / CANCELAR → reiniciar flujo de creación
    if (isIntent(normalized, "MENU") || isIntent(normalized, "REINICIAR") || isIntent(normalized, "CANCELAR")) {
      this._cancelProofReminder(lineId, from);
      await this._setState(lineId, from, "WAIT_NAME");
      // Reset completed flag para permitir nuevo flujo
      this.sessionStore.upsert(lineId, from, (s) => {
        s.completed = false;
        return s;
      });
      await this._reply(lineId, from, cfg.createUser.askName);
      await this._log("CMD_RESTART", { lineId, from, text: normalized });
      return;
    }

    // ✅ Comando DEPOSITO (desde cualquier estado que no sea WAIT_NAME)
    if (isIntent(normalized, "DEPOSITO")) {
      if (sessionAfterCheck.state === "WAIT_NAME") {
        await this._reply(lineId, from, cfg.createUser.askName);
        return;
      }

      await this._reply(lineId, from, bankMsg);
      await this._reply(lineId, from, cbuMsg);

      // Enviar imagen de depósito si está configurada
      if (depositImagePath) {
        await this._sendImage(lineId, from, depositImagePath);
      }

      this.sessionStore.upsert(lineId, from, (s) => {
        s.completed = false;
        s.state = "WAIT_PROOF";
        s.data = s.data || {};
        s.data.depositResponse = "SI";
        s.data.waitingProofSince = Date.now();
        return s;
      });

      await this._reply(lineId, from, askProofMsg);

      // ✅ Iniciar timer de recordatorio
      this._scheduleProofReminder(lineId, from, proofReminderMsg, proofReminderMinutes);

      await this._log("DEPOSIT_COMMAND", {
        lineId,
        from,
        message: "Intent DEPOSITO detectado: envío datos + CBU y espero comprobante",
        text: normalized
      });

      if (this.sheetsLogger) {
        try {
          await this.sheetsLogger.updateDeposit(cleanPhone, true);
        } catch (error) {
          this._log("SHEETS_UPDATE_ERROR", { lineId, from, error: error.message });
        }
      }

      return;
    }

    // ═══════════════════════════════════════
    // ✅ WAIT_NAME: pedir nombre
    // ═══════════════════════════════════════
    if (sessionAfterCheck.state === "WAIT_NAME") {
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });

      // ✅ FIX: Verificar si es un comando ANTES de tratar como nombre
      if (isIntent(normalized, "INFO")) {
        await this._reply(lineId, from, cfg.info.text);
        await this._reply(lineId, from, cfg.createUser.askName);
        await this._log("WAIT_NAME_CMD_INFO", { lineId, from });
        return;
      }
      if (isIntent(normalized, "SOPORTE")) {
        await this._reply(lineId, from, cfg.support.text);
        await this._reply(lineId, from, cfg.createUser.askName);
        await this._log("WAIT_NAME_CMD_SOPORTE", { lineId, from });
        return;
      }
      if (isIntent(normalized, "CREAR_USUARIO")) {
        await this._reply(lineId, from, cfg.createUser.askName);
        await this._log("WAIT_NAME_CMD_CREAR", { lineId, from });
        return;
      }

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

      // ✅ FIX: No bloquear preventivamente por CF — intentar crear y manejar el error si falla
      // El check de CF antes bloqueaba a los usuarios incluso cuando la cookie aún servía
      const cfCheck = this.cfMaintainer.checkAndRenewIfNeeded();
      if (cfCheck.needsRenewal) {
        await this._log("CF_STATUS_PRE_CREATE", {
          lineId,
          from,
          reason: cfCheck.reason,
          priority: cfCheck.priority,
          message: "CF necesita renovación pero se intenta crear usuario de todos modos"
        });
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

        await this._setState(lineId, from, "WAIT_NAME");
        await this._reply(lineId, from, cfg.createUser.askName);
        return;
      }

      // ✅ CUENTA CREADA → Etiqueta + dato como mensajes SEPARADOS (6 mensajes)
      await this._reply(lineId, from, createdUserLabel);    // "👤 Tu usuario es:"
      await this._reply(lineId, from, res.username);         // "martin4479_starwin"
      await this._reply(lineId, from, createdPassLabel);     // "🔑 Tu contraseña es:"
      await this._reply(lineId, from, res.password);          // "Hola1234"
      await this._reply(lineId, from, createdUrlLabel);      // "🌐 Ingresá acá:"
      await this._reply(lineId, from, cfg.url);               // "https://admin.starwin.plus"

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
            telefono: cleanPhone,
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

    // ═══════════════════════════════════════
    // ✅ WAIT_DEPOSIT: responder SI / NO
    // ═══════════════════════════════════════
    if (sessionAfterCheck.state === "WAIT_DEPOSIT") {
      this.sessionStore.upsert(lineId, from, (s) => {
        s.meta.lastActionAt = 0;
        return s;
      });

      const response = normalized;

      if (isIntent(response, "YES")) {
        await this._reply(lineId, from, bankMsg);
        await this._reply(lineId, from, cbuMsg);

        // Enviar imagen de depósito si está configurada
        if (depositImagePath) {
          await this._sendImage(lineId, from, depositImagePath);
        }

        this.sessionStore.upsert(lineId, from, (s) => {
          s.completed = false;
          s.state = "WAIT_PROOF";
          s.data = s.data || {};
          s.data.depositResponse = "SI";
          s.data.waitingProofSince = Date.now();
          return s;
        });

        await this._reply(lineId, from, askProofMsg);

        // ✅ Iniciar timer de recordatorio
        this._scheduleProofReminder(lineId, from, proofReminderMsg, proofReminderMinutes);

        await this._log("DEPOSIT_YES", {
          lineId,
          from,
          message: "Usuario quiere depositar (envío datos + CBU + imagen, esperando comprobante)"
        });

        if (this.sheetsLogger) {
          try {
            await this.sheetsLogger.updateDeposit(cleanPhone, true);
          } catch (error) {
            this._log("SHEETS_UPDATE_ERROR", { lineId, from, error: error.message });
          }
        }

        return;
      }

      if (isIntent(response, "NO")) {
        await this._reply(lineId, from, depositNoMsg);

        await this._log("DEPOSIT_NO", {
          lineId,
          from,
          message: "Usuario no quiere depositar (se informa comando DEPOSITO)"
        });

        if (this.sheetsLogger) {
          try {
            await this.sheetsLogger.updateDeposit(cleanPhone, false);
          } catch (error) {
            this._log("SHEETS_UPDATE_ERROR", { lineId, from, error: error.message });
          }
        }

        this.sessionStore.upsert(lineId, from, (s) => {
          s.completed = true;
          s.state = "COMPLETED";
          s.data = s.data || {};
          s.data.depositResponse = "NO";
          s.data.completedAt = Date.now();
          return s;
        });

        return;
      }

      // Si no fue una respuesta válida, repetir pregunta
      await this._reply(lineId, from, cfg.createUser.askDeposit);
      return;
    }

    // ═══════════════════════════════════════
    // COMANDOS DESDE ESTADO LIBRE (no están en un flujo activo)
    // ═══════════════════════════════════════

    // ✅ INFO → responder info y arrancar creación
    if (isIntent(normalized, "INFO")) {
      await this._reply(lineId, from, cfg.info.text);
      // Solo arrancar creación si no tiene cuenta aún
      if (!sessionAfterCheck.completed) {
        await this._setState(lineId, from, "WAIT_NAME");
        await this._reply(lineId, from, cfg.createUser.askName);
      }
      await this._log("FLOW_INFO", { lineId, from });
      return;
    }

    // ✅ SOPORTE → responder soporte y arrancar creación
    if (isIntent(normalized, "SOPORTE")) {
      await this._reply(lineId, from, cfg.support.text);
      if (!sessionAfterCheck.completed) {
        await this._setState(lineId, from, "WAIT_NAME");
        await this._reply(lineId, from, cfg.createUser.askName);
      }
      await this._log("FLOW_SUPPORT", { lineId, from });
      return;
    }

    // ✅ CREAR USUARIO
    if (isIntent(normalized, "CREAR_USUARIO")) {
      await this._setState(lineId, from, "WAIT_NAME");
      this.sessionStore.upsert(lineId, from, (s) => {
        s.completed = false;
        return s;
      });
      await this._reply(lineId, from, cfg.createUser.askName);
      await this._log("FLOW_CREATE_START", { lineId, from });
      return;
    }

    // ✅ OLVIDE MI USUARIO → buscar en Sheets y enviar datos
    if (isIntent(normalized, "OLVIDE_USUARIO")) {
      if (this.sheetsLogger) {
        const lookup = await this.sheetsLogger.lookupUserByPhone(cleanPhone);
        if (lookup.found) {
          await this._reply(lineId, from, forgotUserMsg);
          await this._reply(lineId, from, lookup.user.usuario);
          await this._reply(lineId, from, createdPassLabel);
          await this._reply(lineId, from, lookup.user.password);
          await this._reply(lineId, from, createdUrlLabel);
          await this._reply(lineId, from, cfg.url || "https://admin.starwin.plus");
          await this._log("FORGOT_USER_SENT", { lineId, from, usuario: lookup.user.usuario });
        } else {
          await this._reply(lineId, from, userNotFoundMsg);
          await this._setState(lineId, from, "WAIT_NAME");
          await this._log("FORGOT_USER_NOT_FOUND", { lineId, from });
        }
      } else {
        await this._reply(lineId, from, "⚠️ El sistema de datos no está disponible. Intentá más tarde.");
      }
      return;
    }

    // ═══════════════════════════════════════
    // ✅ CATCH-ALL: mensajes no reconocidos
    // ═══════════════════════════════════════

    // Si la sesión ya completó el flujo → mensaje de bienvenida de vuelta
    if (sessionAfterCheck.completed || sessionAfterCheck.state === "COMPLETED") {
      await this._reply(lineId, from, welcomeBackMsg);
      await this._log("WELCOME_BACK", {
        lineId,
        from,
        text: msg.substring(0, 50),
        message: "Sesión completada, enviando mensaje de bienvenida"
      });
      return;
    }

    // ✅ NUEVO: Si no tiene sesión completada, verificar si ya existe en Sheets
    // Esto cubre el caso de: app se reinició, sessions.json se limpió, pero el usuario ya tenía cuenta
    if (this.sheetsLogger) {
      try {
        const lookup = await this.sheetsLogger.lookupUserByPhone(cleanPhone);
        if (lookup.found) {
          // Usuario ya existe en Sheets → saludar por nombre con menú
          const personalGreeting = returningUserMsg.replace(/\{nombre\}/g, lookup.user.nombre || "");

          // Marcar sesión como completada para que no intente crear usuario de nuevo
          this.sessionStore.upsert(lineId, from, (s) => {
            s.completed = true;
            s.state = "COMPLETED";
            s.data = s.data || {};
            s.data.name = lookup.user.nombre;
            s.data.username = lookup.user.usuario;
            s.data.restoredFromSheets = true;
            return s;
          });

          await this._reply(lineId, from, personalGreeting);
          await this._log("RETURNING_USER_FROM_SHEETS", {
            lineId,
            from,
            nombre: lookup.user.nombre,
            usuario: lookup.user.usuario,
            message: "Usuario encontrado en Sheets, sesión restaurada"
          });
          return;
        }
      } catch (lookupErr) {
        this._log("LOOKUP_ERROR", {
          lineId,
          from,
          error: lookupErr.message,
          message: "Error buscando usuario en Sheets, continuando con flujo normal"
        });
      }
    }

    // Si no completó y no está en Sheets → iniciar flujo de creación automáticamente
    await this._setState(lineId, from, "WAIT_NAME");
    await this._reply(lineId, from, cfg.createUser.askName);
    await this._log("AUTO_CREATE_START", {
      lineId,
      from,
      text: msg.substring(0, 50),
      message: "Mensaje recibido, iniciando flujo de creación automático"
    });

    } catch (error) {
      // ✅ GUARD GLOBAL: Nunca dejar que un error en el engine crashee la línea de WhatsApp
      console.error(`[ENGINE] ERROR FATAL en handleIncoming:`, error);
      this._log?.("ENGINE_FATAL_ERROR", {
        lineId,
        from,
        error: error.message,
        stack: error.stack?.substring(0, 300),
        message: "Error no capturado en handleIncoming — la línea NO se desconecta"
      });
    }
  }

  // ═══════════════════════════════════════
  // ✅ NUEVO: Timer de recordatorio de comprobante
  // ═══════════════════════════════════════
  _scheduleProofReminder(lineId, from, reminderMsg, minutes) {
    if (!minutes || minutes <= 0) return;

    const key = `${lineId}::${from}`;

    // Cancelar timer anterior si existe
    this._cancelProofReminder(lineId, from);

    const timeoutMs = minutes * 60 * 1000;

    const timer = setTimeout(async () => {
      try {
        // Verificar que sigue en WAIT_PROOF antes de mandar
        const session = this.sessionStore.get(lineId, from);
        if (session?.state === "WAIT_PROOF") {
          await this._reply(lineId, from, reminderMsg);
          await this._log("PROOF_REMINDER_SENT", {
            lineId,
            from,
            minutes,
            message: `Recordatorio de comprobante enviado (${minutes} min)`
          });
        }
      } catch (error) {
        this._log("PROOF_REMINDER_ERROR", {
          lineId,
          from,
          error: error.message
        });
      } finally {
        this._proofReminders.delete(key);
      }
    }, timeoutMs);

    this._proofReminders.set(key, timer);

    this._log("PROOF_REMINDER_SCHEDULED", {
      lineId,
      from,
      minutes,
      message: `Recordatorio programado en ${minutes} minutos`
    });
  }

  _cancelProofReminder(lineId, from) {
    const key = `${lineId}::${from}`;
    const existing = this._proofReminders.get(key);
    if (existing) {
      clearTimeout(existing);
      this._proofReminders.delete(key);
    }
  }

  // ═══════════════════════════════════════
  // Métodos existentes
  // ═══════════════════════════════════════

  async _sendMenu(lineId, to, cfg, force = false) {
    await this._setState(lineId, to, "WAIT_NAME");
    await this._reply(lineId, to, cfg.createUser.askName);
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
        fallback: !res.fallback,
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

    // ✅ Pequeño delay entre mensajes para evitar anti-spam de WhatsApp
    await new Promise(r => setTimeout(r, 800));
  }

  async _sendImage(lineId, to, imagePath, caption = "") {
    if (!this.onSendImage) {
      await this._log("SEND_IMAGE_NO_HANDLER", {
        lineId,
        to,
        message: "No hay handler de imagen configurado"
      });
      return;
    }

    await this._log("SEND_IMAGE_ATTEMPT", {
      lineId,
      to,
      imagePath,
      caption: (caption || "").substring(0, 50),
      message: "Enviando imagen de depósito"
    });

    const res = await this.onSendImage({ lineId, to, imagePath, caption });

    if (res?.ok) {
      await this._log("SEND_IMAGE_OK", {
        lineId,
        to,
        message: "Imagen de depósito enviada exitosamente"
      });
    } else {
      await this._log("SEND_IMAGE_FAIL", {
        lineId,
        to,
        error: res?.error || "unknown",
        message: "Error enviando imagen de depósito"
      });
    }

    // ✅ Delay después de enviar imagen
    await new Promise(r => setTimeout(r, 1000));
  }

  async _setState(lineId, chatId, state) {
    this.sessionStore.upsert(lineId, chatId, (s) => {
      const prev = s.state;
      s.state = state;
      s.meta.lastStateChange = Date.now();
      s.meta.previousState = prev;
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
  OLVIDE_USUARIO: {
    exact: ["OLVIDE MI USUARIO", "OLVIDE", "MI USUARIO", "MIS DATOS", "NO RECUERDO MI USUARIO", "OLVIDÉ MI USUARIO", "OLVIDÉ"],
    contains: ["OLVIDE MI", "OLVIDE EL USUARIO", "NO ME ACUERDO", "CUAL ERA MI USUARIO", "CUAL ES MI USUARIO", "NO SE MI USUARIO", "PERDI MI USUARIO", "RECUPERAR USUARIO", "RECUPERAR MI CUENTA", "MIS CREDENCIALES"]
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
  return /^[A-Za-zÀÁÉÍÓÚÜÑàáéíóúüñ\s'-]+$/.test(name);
}

module.exports = { BotEngine };