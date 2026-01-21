// main.js (CommonJS)
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const { LineManager } = require("./whatsapp/lineManager");
const { BotEngine } = require("./bot/engine");
const { SessionStore } = require("./bot/sessionStore");
const { ConfigStore } = require("./bot/configStore");
const { UserCreator } = require("./bot/userCreator");

let win;

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: "#0b0f17",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---- APP INIT ----
let lineManager;
let botEngine;
let configStore;
let sessionStore;
let userCreator;

app.whenReady().then(() => {
  createWindow();

  // Stores
  const userDataPath = app.getPath("userData");
  console.log(`[MAIN] userData path: ${userDataPath}`);
  
  configStore = new ConfigStore({ basePath: userDataPath });
  sessionStore = new SessionStore({ basePath: userDataPath });
  
  // Limpiar sesiones incompletas al iniciar
  sessionStore.cleanIncompleted();
  
  userCreator = new UserCreator();

  // ✅ PRIMERO: Crear LineManager (sin dependencias)
  lineManager = new LineManager({
    basePath: app.getPath("userData"),
    onQr: (lineId, dataUrl) => send("lines:qr", { lineId, dataUrl }),
    onStatus: (lineId, status) => send("lines:status", { lineId, status }),
    onMessage: async (lineId, msg) => {
      send("lines:message", { lineId, message: msg });
      try {
        await botEngine.handleIncoming({
          lineId,
          from: msg.from,
          text: msg.body,
          ts: msg.timestamp
        });
      } catch (err) {
        console.error(`[MAIN] Error en handleIncoming:`, err);
      }
    }
  });

  // ✅ SEGUNDO: Crear BotEngine (ahora lineManager ya existe)
  botEngine = new BotEngine({
    configStore,
    sessionStore,
    userCreator,
    onSendMessage: async ({ lineId, to, text }) => {
      return await lineManager.sendText(lineId, to, text);
    },
    onLog: (entry) => {
      send("log:event", entry);
    }
  });

  // ---- IPC ----
  ipcMain.handle("lines:list", async () => lineManager.listLines());
  ipcMain.handle("lines:start", async (_e, lineId) => lineManager.startLine(lineId));
  ipcMain.handle("lines:stop", async (_e, lineId) => lineManager.stopLine(lineId));
  ipcMain.handle("lines:status", async (_e, lineId) => lineManager.getStatus(lineId));

  ipcMain.handle("config:get", async () => configStore.get());
  ipcMain.handle("config:set", async (_e, patch) => configStore.update(patch));

  // para debugging rápido desde UI:
  ipcMain.handle("sessions:count", async () => sessionStore.count());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
