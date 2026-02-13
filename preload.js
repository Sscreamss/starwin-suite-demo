const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Lines
  linesList: () => ipcRenderer.invoke("lines:list"),
  linesStart: (lineId) => ipcRenderer.invoke("lines:start", lineId),
  linesStop: (lineId) => ipcRenderer.invoke("lines:stop", lineId),
  linesStatus: (lineId) => ipcRenderer.invoke("lines:status", lineId),
  // ✅ NUEVO: Nombres editables de líneas
  linesGetNames: () => ipcRenderer.invoke("lines:get-names"),
  linesSetName: (lineId, name) => ipcRenderer.invoke("lines:set-name", lineId, name),

  // Config
  configGet: () => ipcRenderer.invoke("config:get"),
  configSet: (patch) => ipcRenderer.invoke("config:set", patch),

  // Sessions
  sessionsCount: () => ipcRenderer.invoke("sessions:count"),

  // Paths / helpers
  pathsGet: () => ipcRenderer.invoke("paths:get"),
  openConfigFolder: () => ipcRenderer.invoke("config:open-folder"),

  // Starwin / Cloudflare
  starwinRenewClearance: () => ipcRenderer.invoke("starwin:renew-clearance"),
  cfAutoRenew: () => ipcRenderer.invoke("cf:auto-renew"),
  cfStatus: () => ipcRenderer.invoke("cf:status"),

  // ✅ Auto-renew interval config
  cfGetAutoRenewInterval: () => ipcRenderer.invoke("cf:get-auto-renew-interval"),
  cfSetAutoRenewInterval: (minutes) => ipcRenderer.invoke("cf:set-auto-renew-interval", minutes),

  // ✅ Deposit image config
  configSelectDepositImage: () => ipcRenderer.invoke("config:select-deposit-image"),
  configRemoveDepositImage: () => ipcRenderer.invoke("config:remove-deposit-image"),
  configGetDepositImage: () => ipcRenderer.invoke("config:get-deposit-image"),

  // Dashboard / Google Sheets
  dashboardGetStats: () => ipcRenderer.invoke("dashboard:get-stats"),
  dashboardGetUsersByDay: (days) => ipcRenderer.invoke("dashboard:get-users-by-day", days),
  dashboardGetRecentUsers: (limit) => ipcRenderer.invoke("dashboard:get-recent-users", limit),

  // Events
  onLineQr: (callback) => {
    ipcRenderer.removeAllListeners("lines:qr");
    ipcRenderer.on("lines:qr", (_event, data) => callback(data.lineId, data.qrCode));
  },
  onLineStatus: (callback) => {
    ipcRenderer.removeAllListeners("lines:status");
    ipcRenderer.on("lines:status", (_event, data) => callback(data.lineId, data));
  },
  onLineMessage: (callback) => {
    ipcRenderer.removeAllListeners("lines:message");
    ipcRenderer.on("lines:message", (_event, data) => callback(data.lineId, data));
  },
  onLogEvent: (callback) => {
    ipcRenderer.removeAllListeners("log:event");
    ipcRenderer.on("log:event", (_event, data) => callback(data));
  },
  // ✅ Eventos de auto-renew
  onCfAutoRenewed: (callback) => {
    ipcRenderer.removeAllListeners("cf:auto-renewed");
    ipcRenderer.on("cf:auto-renewed", (_event, data) => callback(data));
  },
  onCfTimerReset: (callback) => {
    ipcRenderer.removeAllListeners("cf:timer-reset");
    ipcRenderer.on("cf:timer-reset", (_event, data) => callback(data));
  },
  onCfTimerConfig: (callback) => {
    ipcRenderer.removeAllListeners("cf:timer-config");
    ipcRenderer.on("cf:timer-config", (_event, data) => callback(data));
  },
  onCfAutoRenewStatus: (callback) => {
    ipcRenderer.removeAllListeners("cf:auto-renew-status");
    ipcRenderer.on("cf:auto-renew-status", (_event, data) => callback(data));
  }
});