// whatsapp/lineManager.js
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js"); // ✅ AGREGADO: MessageMedia
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

    this._log("INIT", "LineManager inicializado");
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

  async listLines() {
    try {
      const linesDir = path.join(this.basePath, "lines");
      if (!fs.existsSync(linesDir)) {
        fs.mkdirSync(linesDir, { recursive: true });
        return Array.from({ length: 30 }, (_, i) => ({
          lineId: `line${String(i + 1).padStart(3, "0")}`,
          name: `Línea ${i + 1}`,
          createdAt: new Date().toISOString(),
        }));
      }

      const lines = Array.from({ length: 30 }, (_, i) => ({
        lineId: `line${String(i + 1).padStart(3, "0")}`,
        name: `Línea ${i + 1}`,
        createdAt: new Date().toISOString(),
      }));

      return lines;
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

      const chromePath = findChromePath();
      if (!chromePath) {
        const msg = "❌ No se encontró Chrome/Edge instalado (executablePath nulo)";
        this._log("START_ERROR", msg, lineId);
        this.statuses.set(lineId, { state: "ERROR", error: msg });
        this.onStatus?.(lineId, { state: "ERROR", error: msg });
        return { ok: false, error: msg };
      }

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: lineId,
          dataPath: path.join(this.basePath, "sessions"),
        }),
        puppeteer: {
          headless: true,
          executablePath: chromePath,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
          ],
        },
      });

      client.on("qr", async (qr) => {
        this._log("QR", "Código QR generado", lineId);

        const qrcode2 = require("qrcode-terminal");
        qrcode2.generate(qr, { small: true });

        // Generar QR como imagen base64
        const QRCode = require("qrcode-terminal");
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;

        this.statuses.set(lineId, {
          state: "QR",
          qr: qrImageUrl,
        });

        this.onQr?.(lineId, qrImageUrl);
      });

      client.on("ready", () => {
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
      });

      client.on("authenticated", () => {
        this._log("AUTHENTICATED", "Autenticado", lineId);
        this.statuses.set(lineId, { state: "AUTHENTICATED" });
        this.onStatus?.(lineId, { state: "AUTHENTICATED" });
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
      });

      client.on("auth_failure", (error) => {
        this._log("AUTH_FAILURE", `Error de autenticación: ${error}`, lineId);
        this.statuses.set(lineId, {
          state: "AUTH_FAILURE",
          error: String(error),
        });
        this.onStatus?.(lineId, {
          state: "AUTH_FAILURE",
          error: String(error),
        });
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

      await client.destroy();
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

  // ✅ NUEVO: Enviar imagen por WhatsApp
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
}

module.exports = { LineManager };