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
    this.onMessage = onMessage;  // ✅ Guardar como referencia

    this.clients = new Map();
    this.status = new Map();

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
      },
      // evita el bug de "markedUnread" / sendSeen en ciertos builds de WhatsApp Web
      disableAutoMarkSeen: true
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
    });

    client.on("disconnected", (reason) => {
      this.setStatus(lineId, { state: "DISCONNECTED", reason: String(reason || "") });
    });

    // ✅ MEJOR: Aceptar TODOS los mensajes y debuggear
    client.on("message", async (msg) => {
      const from = String(msg.from || "");
      const body = String(msg.body || "").trim();

      // Log para debuggear
      console.log(`[${lineId}] Raw message from: ${from}, body: "${body}"`);

      // Ignorar estados
      if (from === "status@broadcast") {
        console.log(`[${lineId}] Ignorado: status broadcast`);
        return;
      }

      // Ignorar grupos
      if (from.endsWith("@g.us")) {
        console.log(`[${lineId}] Ignorado: grupo`);
        return;
      }

      // ✅ Aceptar @c.us Y @lid
      if (!from.endsWith("@c.us") && !from.endsWith("@lid")) {
        console.log(`[${lineId}] Ignorado: tipo desconocido (${from})`);
        return;
      }

      // Ignorar vacíos
      if (!body) {
        console.log(`[${lineId}] Ignorado: mensaje vacío`);
        return;
      }

      console.log(`[${lineId}] ✅ Aceptado: ${from} -> ${body}`);

      const payload = {
        from,
        body,
        timestamp: msg.timestamp
      };

      // ✅ Ejecutar callback con manejo de errores
      try {
        if (this.onMessage) {
          await this.onMessage(lineId, payload);
        }
      } catch (err) {
        console.error(`[${lineId}] Error en onMessage:`, err);
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

  // ✅ envío robusto (con fallback por si aparece un id raro)
  async sendText(lineId, to, text) {
    const client = this.clients.get(String(lineId));
    if (!client) return { ok: false, error: "LINE_NOT_RUNNING" };

    try {
      await client.sendMessage(to, text);
      return { ok: true, used: to };
    } catch (e1) {
      // fallback: si alguna vez llega algo inesperado
      try {
        if (String(to).endsWith("@lid")) {
          const alt = String(to).replace("@lid", "@c.us");
          await client.sendMessage(alt, text);
          return { ok: true, used: alt, fallback: true };
        }
        throw e1;
      } catch (e2) {
        return { ok: false, error: e2?.message || String(e2) };
      }
    }
  }
}

module.exports = { LineManager };
