// preload.js
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

  // Events
  onLineQr: (cb) => ipcRenderer.on("lines:qr", (_e, p) => cb(p)),
  onLineStatus: (cb) => ipcRenderer.on("lines:status", (_e, p) => cb(p)),
  onLineMessage: (cb) => ipcRenderer.on("lines:message", (_e, p) => cb(p)),
  onLogEvent: (cb) => ipcRenderer.on("log:event", (_e, p) => cb(p))
});
