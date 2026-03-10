// whatsapp/lineManager.js
// ✅ SHARED BROWSER: Un solo proceso de Chrome para todas las líneas
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

/**
 * Encuentra Chrome o Edge instalado en el sistema.
 */
function findChromePath() {
  const platform = process.platform;

  const candidatesByPlatform = {
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
    ],
  };

  const candidates = [...(candidatesByPlatform[platform] || [])];

  if (platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(
      path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
    );
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }

  return null;
}

// ═══════════════════════════════════════
// Constantes de configuración
// ═══════════════════════════════════════
const STARTUP_BATCH_SIZE = 5;         // Cuántas líneas iniciar al mismo tiempo como máximo
const STARTUP_BATCH_DELAY = 2000;     // ms entre batches al reconectar
const WATCHDOG_INTERVAL = 15000;      // ms entre chequeos del watchdog
const RECONNECT_DELAY_PER_LINE = 500; // ms entre reconexiones individuales

class LineManager {
  constructor({ basePath, onQr, onStatus, onMessage, onLog }) {
    this.basePath = basePath;
    this.onQr = onQr;
    this.onStatus = onStatus;
    this.onMessage = onMessage;
    this.onLog = onLog;
    this.engine = null;
    this.clients = new Map();
    this.statuses = new Map();

    // ✅ SHARED BROWSER
    this._sharedBrowser = null;
    this._browserWsEndpoint = null;
    this._browserLaunching = false;   // Lock para evitar launches simultáneos
    this._watchdogTimer = null;
    this._reconnecting = false;       // Lock para evitar reconexiones simultáneas
    this._linesBeforecrash = [];      // Líneas que estaban activas antes de un crash

    this._log("INIT", "LineManager inicializado (modo browser compartido)");
  }

  _log(type, message, lineId = null) {
    this.onLog?.({
      at: new Date().toISOString(),
      type: `LINE_${type}`,
      message,
      lineId,
    });
    console.log(`[LineManager${lineId ? `:${lineId}` : ""}] ${message}`);
  }

  setEngine(engine) {
    this.engine = engine;
    this._log("ENGINE_SET", "Motor de bot configurado");
  }

  // ═══════════════════════════════════════
  // ✅ SHARED BROWSER MANAGEMENT
  // ═══════════════════════════════════════

  /**
   * Lanza o reutiliza el browser compartido.
   * Devuelve el wsEndpoint para conectar Clients.
   */
  async _ensureSharedBrowser() {
    // Si ya tenemos browser vivo, devolver su endpoint
    if (this._sharedBrowser && this._browserWsEndpoint) {
      try {
        // Verificar que el browser sigue vivo
        const pages = await this._sharedBrowser.pages();
        if (pages !== undefined) {
          return this._browserWsEndpoint;
        }
      } catch {
        this._log("BROWSER_DEAD", "Browser compartido detectado como muerto, relanzando...");
        this._sharedBrowser = null;
        this._browserWsEndpoint = null;
      }
    }

    // Evitar launches simultáneos
    if (this._browserLaunching) {
      // Esperar a que termine el launch en curso
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (this._browserWsEndpoint) return this._browserWsEndpoint;
        if (!this._browserLaunching) break;
      }
      if (this._browserWsEndpoint) return this._browserWsEndpoint;
      throw new Error("Timeout esperando al browser compartido");
    }

    this._browserLaunching = true;

    try {
      const chromePath = findChromePath();
      if (!chromePath) {
        throw new Error("❌ No se encontró Chrome/Edge instalado");
      }

      this._log("BROWSER_LAUNCHING", `🌐 Lanzando browser compartido (${path.basename(chromePath)})...`);

      const puppeteer = require("puppeteer-core");

      this._sharedBrowser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          // ✅ Flags adicionales para ahorro de memoria
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-sync",
          "--disable-translate",
          "--metrics-recording-only",
          "--mute-audio",
          "--no-default-browser-check",
          "--disable-hang-monitor",
          "--disable-prompt-on-repost",
          "--disable-domain-reliability",
          "--disable-component-update",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-ipc-flooding-protection",
          "--js-flags=--max-old-space-size=128",
        ],
        defaultViewport: null,
      });

      this._browserWsEndpoint = this._sharedBrowser.wsEndpoint();

      this._log("BROWSER_READY", `✅ Browser compartido listo (endpoint: ${this._browserWsEndpoint.substring(0, 40)}...)`);

      // ✅ Manejar desconexión del browser
      this._sharedBrowser.on("disconnected", () => {
        this._log("BROWSER_CRASHED", "💥 Browser compartido se desconectó! Guardando estado de líneas...");

        // Guardar qué líneas estaban activas para reconectar
        this._linesBeforecrash = Array.from(this.clients.keys());

        // Marcar todas las líneas como desconectadas
        for (const [lineId] of this.clients) {
          this.statuses.set(lineId, { state: "DISCONNECTED", reason: "BROWSER_CRASH" });
          this.onStatus?.(lineId, { state: "DISCONNECTED", reason: "BROWSER_CRASH" });
        }
        this.clients.clear();

        this._sharedBrowser = null;
        this._browserWsEndpoint = null;

        // ✅ Auto-reconexión progresiva
        this._autoReconnect();
      });

      // ✅ Iniciar watchdog
      this._startWatchdog();

      return this._browserWsEndpoint;
    } catch (error) {
      this._log("BROWSER_ERROR", `❌ Error lanzando browser: ${error.message}`);
      this._sharedBrowser = null;
      this._browserWsEndpoint = null;
      throw error;
    } finally {
      this._browserLaunching = false;
    }
  }

  /**
   * Watchdog: verifica periódicamente que el browser siga vivo.
   */
  _startWatchdog() {
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);

    this._watchdogTimer = setInterval(async () => {
      if (!this._sharedBrowser) return;

      try {
        // Intentar operación simple para verificar que responde
        await this._sharedBrowser.version();
      } catch {
        this._log("WATCHDOG_DEAD", "🐕 Watchdog: browser no responde, forzando reconexión");
        
        // Forzar limpieza
        this._linesBeforecrash = Array.from(this.clients.keys());
        
        for (const [lineId] of this.clients) {
          this.statuses.set(lineId, { state: "DISCONNECTED", reason: "WATCHDOG_RESTART" });
          this.onStatus?.(lineId, { state: "DISCONNECTED", reason: "WATCHDOG_RESTART" });
        }
        this.clients.clear();

        try { this._sharedBrowser.process()?.kill('SIGKILL'); } catch {}
        this._sharedBrowser = null;
        this._browserWsEndpoint = null;

        this._autoReconnect();
      }
    }, WATCHDOG_INTERVAL);
  }

  /**
   * Reconexión automática progresiva de las líneas que estaban activas.
   * Las reconecta de a batches para no saturar.
   */
  async _autoReconnect() {
    if (this._reconnecting) {
      this._log("RECONNECT_SKIP", "Ya hay una reconexión en curso, ignorando");
      return;
    }

    const linesToReconnect = [...this._linesBeforecrash];
    this._linesBeforecrash = [];

    if (linesToReconnect.length === 0) return;

    this._reconnecting = true;
    this._log("RECONNECT_START", `🔄 Reconectando ${linesToReconnect.length} líneas (batches de ${STARTUP_BATCH_SIZE})...`);

    try {
      // Esperar un momento para que el browser anterior termine de morir
      await new Promise(r => setTimeout(r, 3000));

      // Procesar en batches
      for (let i = 0; i < linesToReconnect.length; i += STARTUP_BATCH_SIZE) {
        const batch = linesToReconnect.slice(i, i + STARTUP_BATCH_SIZE);
        const batchNum = Math.floor(i / STARTUP_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(linesToReconnect.length / STARTUP_BATCH_SIZE);

        this._log("RECONNECT_BATCH", `📦 Batch ${batchNum}/${totalBatches}: reconectando ${batch.join(", ")}`);

        // Iniciar todas las líneas del batch en paralelo
        const results = await Promise.allSettled(
          batch.map(lineId => this.startLine(lineId))
        );

        // Log resultados
        results.forEach((result, idx) => {
          const lineId = batch[idx];
          if (result.status === "fulfilled" && result.value?.ok) {
            this._log("RECONNECT_OK", `✅ ${lineId} reconectada`, lineId);
          } else {
            const err = result.status === "rejected" ? result.reason?.message : result.value?.error;
            this._log("RECONNECT_FAIL", `❌ ${lineId} falló: ${err}`, lineId);
          }
        });

        // Delay entre batches
        if (i + STARTUP_BATCH_SIZE < linesToReconnect.length) {
          await new Promise(r => setTimeout(r, STARTUP_BATCH_DELAY));
        }
      }

      this._log("RECONNECT_DONE", `🔄 Reconexión completada`);
    } catch (error) {
      this._log("RECONNECT_ERROR", `❌ Error en reconexión: ${error.message}`);
    } finally {
      this._reconnecting = false;
    }
  }

  // ═══════════════════════════════════════
  // LINE MANAGEMENT (usa browser compartido)
  // ═══════════════════════════════════════

  async listLines() {
    try {
      const linesDir = path.join(this.basePath, "lines");
      if (!fs.existsSync(linesDir)) {
        fs.mkdirSync(linesDir, { recursive: true });
      }

      return Array.from({ length: 100 }, (_, i) => ({
        lineId: `line${String(i + 1).padStart(3, "0")}`,
        name: `Línea ${i + 1}`,
        createdAt: new Date().toISOString(),
      }));
    } catch (error) {
      this._log("LIST_ERROR", `Error listando líneas: ${error.message}`);
      return [];
    }
  }

  async startLine(lineId) {
    try {
      if (this.clients.has(lineId)) {
        this._log("START_ERROR", `Línea ${lineId} ya está activa`, lineId);
        return { ok: false, error: "Línea ya activa" };
      }

      this._log("START", `Iniciando línea ${lineId}`, lineId);
      this.statuses.set(lineId, { state: "STARTING" });
      this.onStatus?.(lineId, { state: "STARTING" });

      const sessionDir = path.join(this.basePath, "sessions", lineId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      // ✅ Obtener browser compartido
      const wsEndpoint = await this._ensureSharedBrowser();

      // ✅ Crear Client conectado al browser compartido
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: lineId,
          dataPath: path.join(this.basePath, "sessions"),
        }),
        puppeteer: {
          browserWSEndpoint: wsEndpoint,
        },
      });

      // ✅ Event handlers con aislamiento de errores

      client.on("qr", async (qr) => {
        try {
          this._log("QR", "Código QR generado", lineId);

          const qrcode2 = require("qrcode-terminal");
          qrcode2.generate(qr, { small: true });

          const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;

          this.statuses.set(lineId, {
            state: "QR",
            qr: qrImageUrl,
          });

          this.onQr?.(lineId, qrImageUrl);
        } catch (err) {
          this._log("QR_ERROR", `Error en handler QR: ${err.message}`, lineId);
        }
      });

      client.on("ready", () => {
        try {
          this._log("READY", "Cliente listo", lineId);

          const info = client.info;
          const wid = info.wid?.user || info.me?.user || lineId;
          const pushname = info.pushname || info.me?.name || "Usuario";

          this.statuses.set(lineId, {
            state: "READY",
            wid: `${wid}@c.us`,
            pushname,
            info: client.info,
          });

          this.onStatus?.(lineId, {
            state: "READY",
            wid: `${wid}@c.us`,
            pushname,
          });
        } catch (err) {
          this._log("READY_ERROR", `Error en handler ready: ${err.message}`, lineId);
        }
      });

      client.on("authenticated", () => {
        try {
          this._log("AUTHENTICATED", "Autenticado", lineId);
          this.statuses.set(lineId, { state: "AUTHENTICATED" });
          this.onStatus?.(lineId, { state: "AUTHENTICATED" });
        } catch (err) {
          this._log("AUTH_HANDLER_ERROR", `Error en handler authenticated: ${err.message}`, lineId);
        }
      });

      client.on("message", async (msg) => {
        if (msg.from === "status@broadcast") return;

        try {
          let from = msg.from;
          const body = msg.body || "";
          const timestamp = new Date().toISOString();

          const msgType = msg.type;
          const hasMedia = !!msg.hasMedia;
          const mimetype = msg?._data?.mimetype || null;

          // ✅ FIX: Resolver número real para @lid (nuevo formato de WhatsApp)
          let phoneNumber = "";
          if (from.endsWith("@lid")) {
            try {
              const contact = await msg.getContact();
              phoneNumber = contact?.number || contact?.id?._serialized?.replace("@c.us", "") || "";
            } catch {
              phoneNumber = "";
            }
          } else {
            phoneNumber = from.replace("@c.us", "").replace("@s.whatsapp.net", "");
          }

          this._log(
            "MESSAGE_RECEIVED",
            `Mensaje de ${from}${phoneNumber ? ` (${phoneNumber})` : ''}: ${body.substring(0, 50)} (type=${msgType}, hasMedia=${hasMedia})`,
            lineId
          );

          this.onMessage?.(lineId, {
            from,
            phoneNumber,
            body,
            timestamp,
            type: msgType,
            hasMedia,
            mimetype,
          });

          if (this.engine && (body.trim() || hasMedia || msgType !== "chat")) {
            await this.engine.handleIncoming({
              lineId,
              from,
              phoneNumber,
              text: body,
              ts: timestamp,
              type: msgType,
              hasMedia,
              mimetype,
            });
          }
        } catch (error) {
          this._log("MESSAGE_ERROR", `Error procesando mensaje: ${error.message}`, lineId);
        }
      });

      client.on("disconnected", (reason) => {
        try {
          this._log("DISCONNECTED", `Desconectado: ${reason}`, lineId);
          this.statuses.set(lineId, {
            state: "DISCONNECTED",
            reason: reason || "UNKNOWN",
          });
          this.onStatus?.(lineId, {
            state: "DISCONNECTED",
            reason: reason || "UNKNOWN",
          });
          this.clients.delete(lineId);
        } catch (err) {
          this._log("DISCONNECT_HANDLER_ERROR", `Error en handler disconnected: ${err.message}`, lineId);
        }
      });

      client.on("auth_failure", (error) => {
        try {
          this._log("AUTH_FAILURE", `Error de autenticación: ${error}`, lineId);
          this.statuses.set(lineId, {
            state: "AUTH_FAILURE",
            error: String(error),
          });
          this.onStatus?.(lineId, {
            state: "AUTH_FAILURE",
            error: String(error),
          });
        } catch (err) {
          this._log("AUTH_FAILURE_HANDLER_ERROR", `Error en handler auth_failure: ${err.message}`, lineId);
        }
      });

      await client.initialize();
      this.clients.set(lineId, client);

      return { ok: true, message: `Línea ${lineId} iniciada` };
    } catch (error) {
      this._log("START_ERROR", `Error iniciando línea: ${error.message}`, lineId);
      this.statuses.set(lineId, {
        state: "ERROR",
        error: error.message,
      });
      this.onStatus?.(lineId, {
        state: "ERROR",
        error: error.message,
      });
      return { ok: false, error: error.message };
    }
  }

  async stopLine(lineId) {
    try {
      const client = this.clients.get(lineId);
      if (!client) {
        this._log("STOP_ERROR", `Línea ${lineId} no encontrada`, lineId);
        return { ok: false, error: "Línea no encontrada" };
      }

      this._log("STOP", `Deteniendo línea ${lineId}`, lineId);
      this.statuses.set(lineId, { state: "STOPPING" });
      this.onStatus?.(lineId, { state: "STOPPING" });

      try {
        await client.destroy();
      } catch (destroyErr) {
        this._log("STOP_WARN", `Advertencia al destruir cliente: ${destroyErr.message}`, lineId);
      }

      this.clients.delete(lineId);
      this.statuses.set(lineId, { state: "STOPPED" });
      this.onStatus?.(lineId, { state: "STOPPED" });

      this._log("STOP_SUCCESS", `Línea ${lineId} detenida`, lineId);
      return { ok: true, message: `Línea ${lineId} detenida` };
    } catch (error) {
      this._log("STOP_ERROR", `Error deteniendo línea: ${error.message}`, lineId);
      return { ok: false, error: error.message };
    }
  }

  async getStatus(lineId) {
    const status = this.statuses.get(lineId) || { state: "STOPPED" };
    return { lineId, ...status };
  }

  async sendMessage(lineId, to, text) {
    try {
      const client = this.clients.get(lineId);
      if (!client) {
        this._log("SEND_ERROR", `Línea ${lineId} no activa`, lineId);
        return { ok: false, error: "Línea no activa" };
      }

      const status = this.statuses.get(lineId);
      if (status?.state !== "READY") {
        this._log("SEND_ERROR", `Cliente no está listo (estado: ${status?.state})`, lineId);
        return { ok: false, error: "Cliente no listo" };
      }

      this._log("SEND", `Enviando mensaje a ${to}`, lineId);
      await client.sendMessage(to, text);

      this._log("SEND_SUCCESS", `Mensaje enviado a ${to}`, lineId);
      return { ok: true, used: to };
    } catch (error) {
      this._log("SEND_ERROR", `Error enviando mensaje: ${error.message}`, lineId);
      return { ok: false, error: error.message };
    }
  }

  // ✅ Enviar imagen por WhatsApp
  async sendImage(lineId, to, imagePath, caption = "") {
    try {
      const client = this.clients.get(lineId);
      if (!client) {
        this._log("SEND_IMAGE_ERROR", `Línea ${lineId} no activa`, lineId);
        return { ok: false, error: "Línea no activa" };
      }

      const status = this.statuses.get(lineId);
      if (status?.state !== "READY") {
        this._log("SEND_IMAGE_ERROR", `Cliente no está listo (estado: ${status?.state})`, lineId);
        return { ok: false, error: "Cliente no listo" };
      }

      if (!fs.existsSync(imagePath)) {
        this._log("SEND_IMAGE_ERROR", `Imagen no encontrada: ${imagePath}`, lineId);
        return { ok: false, error: "Imagen no encontrada" };
      }

      this._log("SEND_IMAGE", `Enviando imagen a ${to}: ${path.basename(imagePath)}`, lineId);

      const media = MessageMedia.fromFilePath(imagePath);
      await client.sendMessage(to, media, { caption: caption || "" });

      this._log("SEND_IMAGE_SUCCESS", `Imagen enviada a ${to}`, lineId);
      return { ok: true, used: to };
    } catch (error) {
      this._log("SEND_IMAGE_ERROR", `Error enviando imagen: ${error.message}`, lineId);
      return { ok: false, error: error.message };
    }
  }

  async broadcastMessage(toNumbers, text) {
    const results = [];

    for (const [lineId, client] of this.clients.entries()) {
      const status = this.statuses.get(lineId);
      if (status?.state === "READY") {
        for (const to of toNumbers) {
          try {
            await client.sendMessage(to, text);
            results.push({ lineId, to, success: true });
          } catch (error) {
            results.push({ lineId, to, success: false, error: error.message });
          }
        }
      }
    }

    return results;
  }

  async getAllStatuses() {
    const statuses = [];
    for (const [lineId, status] of this.statuses) {
      statuses.push({ lineId, ...status });
    }
    return statuses;
  }

  async stopAll() {
    // Detener watchdog
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }

    const results = [];
    for (const [lineId, client] of this.clients) {
      try {
        await client.destroy();
        results.push({ lineId, success: true });
        this._log("STOP_ALL", `Línea ${lineId} detenida`, lineId);
      } catch (error) {
        results.push({ lineId, success: false, error: error.message });
        this._log("STOP_ALL_ERROR", `Error deteniendo ${lineId}: ${error.message}`, lineId);
      }
    }
    this.clients.clear();
    this.statuses.clear();

    // ✅ Cerrar browser compartido
    if (this._sharedBrowser) {
      try {
        await this._sharedBrowser.close();
        this._log("BROWSER_CLOSED", "Browser compartido cerrado");
      } catch (err) {
        this._log("BROWSER_CLOSE_ERROR", `Error cerrando browser: ${err.message}`);
        try { this._sharedBrowser.process()?.kill('SIGKILL'); } catch {}
      }
      this._sharedBrowser = null;
      this._browserWsEndpoint = null;
    }

    return results;
  }

  getActiveLines() {
    return Array.from(this.clients.keys());
  }

  getLineCount() {
    return this.clients.size;
  }

  async restartLine(lineId) {
    await this.stopLine(lineId);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await this.startLine(lineId);
  }

  /**
   * ✅ Info del browser compartido (para debug / dashboard)
   */
  getBrowserInfo() {
    return {
      isAlive: !!this._sharedBrowser,
      wsEndpoint: this._browserWsEndpoint ? this._browserWsEndpoint.substring(0, 50) + "..." : null,
      activeClients: this.clients.size,
      reconnecting: this._reconnecting,
    };
  }
}

module.exports = { LineManager };