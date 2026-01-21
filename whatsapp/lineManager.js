// whatsapp/lineManager.js
const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

class LineManager {
  constructor({ basePath, onQr, onStatus, onMessage }) {
    this.basePath = basePath;
    this.onQr = onQr;
    this.onStatus = onStatus;
    this.onMessage = onMessage;

    this.clients = new Map();
    this.status = new Map();
    this.lastMessages = new Map(); // ✅ Guardar último mensaje para reply()

    // 30 líneas fijas
    this.lines = Array.from({ length: 30 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}`);

    ensureDir(this.getAuthRoot());
  }

  getAuthRoot() {
    return path.join(this.basePath, "wwebjs_auth");
  }

  getAuthPath(lineId) {
    return path.join(this.getAuthRoot(), lineId);
  }

  listLines() {
    return this.lines.map((lineId) => ({
      lineId,
      status: this.getStatus(lineId)
    }));
  }

  getStatus(lineId) {
    return this.status.get(lineId) || { state: "STOPPED" };
  }

  setStatus(lineId, status) {
    this.status.set(lineId, status);
    this.onStatus?.(lineId, status);
  }

  async startLine(lineId) {
    lineId = String(lineId);
    if (this.clients.has(lineId)) return { ok: true, already: true };

    this.setStatus(lineId, { state: "STARTING" });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: lineId,
        dataPath: this.getAuthPath(lineId)
      }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      }
    });

    client.on("qr", async (qr) => {
      const dataUrl = await qrcode.toDataURL(qr);
      this.setStatus(lineId, { state: "QR" });
      this.onQr?.(lineId, dataUrl);
    });

    client.on("authenticated", () => {
      this.setStatus(lineId, { state: "AUTHENTICATED" });
    });

    client.on("ready", () => {
      const info = client.info;
      this.setStatus(lineId, {
        state: "READY",
        wid: info?.wid?._serialized || "",
        pushname: info?.pushname || ""
      });
      console.log(`[${lineId}] Client ready!`);
    });

    client.on("disconnected", (reason) => {
      this.setStatus(lineId, { state: "DISCONNECTED", reason: String(reason || "") });
    });

    // ✅ USAR message_create (no message) - según documentación oficial
    client.on("message_create", async (msg) => {
      // ✅ FILTRO: Ignorar mensajes enviados por el bot (outgoing)
      if (msg.fromMe) {
        console.log(`[${lineId}] Ignorando mensaje saliente del bot: "${String(msg.body || "").trim()}"`);
        return;
      }

      const from = String(msg.from || "");
      const body = String(msg.body || "").trim();

      console.log(`[${lineId}] Message from: ${from}, body: "${body}"`);

      // Ignorar estados
      if (from === "status@broadcast") {
        console.log(`[${lineId}] Ignored: status`);
        return;
      }

      // Ignorar grupos
      if (from.endsWith("@g.us")) {
        console.log(`[${lineId}] Ignored: group`);
        return;
      }

      // Aceptar @c.us Y @lid
      if (!from.endsWith("@c.us") && !from.endsWith("@lid")) {
        console.log(`[${lineId}] Ignored: unknown type`);
        return;
      }

      // Ignorar vacíos
      if (!body) {
        console.log(`[${lineId}] Ignored: empty`);
        return;
      }

      console.log(`[${lineId}] ✅ Processing: ${from}`);

      // ✅ Guardar el mensaje para poder responder con reply()
      const key = `${lineId}::${from}`;
      this.lastMessages.set(key, msg);

      const payload = {
        from,
        body,
        timestamp: msg.timestamp
      };

      // Ejecutar callback
      try {
        if (this.onMessage) {
          await this.onMessage(lineId, payload);
        }
      } catch (err) {
        console.error(`[${lineId}] Error in onMessage:`, err);
      }
    });

    this.clients.set(lineId, client);
    await client.initialize();

    return { ok: true };
  }

  async stopLine(lineId) {
    lineId = String(lineId);
    const client = this.clients.get(lineId);
    if (!client) return { ok: true, already: true };

    try {
      await client.destroy();
    } finally {
      this.clients.delete(lineId);
      this.setStatus(lineId, { state: "STOPPED" });
    }
    return { ok: true };
  }

  // ✅ Envío sin markedUnread - usando mecanismo simple
  async sendText(lineId, to, text) {
    const client = this.clients.get(String(lineId));
    if (!client) {
      console.error(`[${lineId}] ERROR: client not found`);
      return { ok: false, error: "CLIENT_NOT_FOUND" };
    }

    try {
      console.log(`[${lineId}] Sending...`);
      
      // Enviar sin usar reply() ni sendMessage() que tienen hooks
      const success = await new Promise((resolve, reject) => {
        try {
          // Intenta sendMessage pero con timeout para evitar que se cuelgue
          const timeoutId = setTimeout(() => {
            reject(new Error("Timeout"));
          }, 5000);

          client.sendMessage(to, text).then(() => {
            clearTimeout(timeoutId);
            resolve(true);
          }).catch((err) => {
            clearTimeout(timeoutId);
            reject(err);
          });
        } catch (e) {
          reject(e);
        }
      });

      console.log(`[${lineId}] ✅ Sent`);
      return { ok: true, used: to };
    } catch (error) {
      const errMsg = error?.message || String(error);
      console.error(`[${lineId}] ERROR:`, errMsg);
      return { ok: false, error: errMsg };
    }
  }
}

module.exports = { LineManager };
