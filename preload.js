const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Lines
  linesList: () => ipcRenderer.invoke("lines:list"),
  linesStart: (lineId) => ipcRenderer.invoke("lines:start", lineId),
  linesStop: (lineId) => ipcRenderer.invoke("lines:stop", lineId),
  linesStatus: (lineId) => ipcRenderer.invoke("lines:status", lineId),

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

  // ✅ AGREGADO: Dashboard / Google Sheets
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
  }
});