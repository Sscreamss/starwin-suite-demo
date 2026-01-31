const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const { ConfigStore } = require("./bot/configStore");
const { SessionStore } = require("./bot/sessionStore");
const { UserCreator } = require("./bot/userCreator");
const { BotEngine } = require("./bot/engine");
const { CFMaintainer } = require("./bot/cfMaintainer");
const { LineManager } = require("./whatsapp/lineManager");
const { SheetsLogger } = require("./bot/sheetsLogger"); // ✅ AGREGADO

let mainWindow = null;
let cfMaintainer = null;
let lineManager = null;
let botEngine = null;
let puppeteerBrowser = null;
let puppeteerPage = null; // ✅ NUEVO: Guardar la página activa
let userCreator = null; // ✅ NUEVO: Mover a global para poder actualizarla
let sheetsLogger = null; // ✅ AGREGADO: SheetsLogger global

function sendLog(payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("log:event", payload);
    }
  } catch {}
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'icon.png'),
    title: 'Starwin Suite Dashboard'
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

// ✅ MÉTODO SIMPLIFICADO: Captura directa desde Puppeteer
async function renewStarwinClearanceWithExtension(configStore) {
  const cfg = configStore.get();
  const starwin = cfg.starwin || {};
  const baseUrl = starwin.baseUrl || "https://admin.starwin.plus";
  
  sendLog({ 
    type: "STARWIN_CF_RENEW_START", 
    message: "🚀 Abriendo navegador automático..."
  });

  try {
    const puppeteer = require('puppeteer-core');
    
    const chromePath = findChromePath();
    
    if (!chromePath) {
      sendLog({
        type: "CF_NO_CHROME",
        message: "❌ No se encontró Chrome/Edge instalado"
      });
      return { ok: false, error: "Chrome/Edge no encontrado" };
    }

    sendLog({
      type: "CF_CHROME_FOUND",
      message: `✅ Navegador encontrado`
    });

    sendLog({
      type: "CF_LAUNCHING",
      message: "🌐 Lanzando navegador..."
    });

    // Lanzar Chrome sin extensión (más simple y confiable)
    puppeteerBrowser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      args: [
        '--no-sandbox',
        // ❌ REMOVIDO: '--disable-setuid-sandbox' causa warning de seguridad
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage'
      ],
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation']
    });

    sendLog({
      type: "CF_BROWSER_LAUNCHED",
      message: "✅ Navegador lanzado"
    });

    const pages = await puppeteerBrowser.pages();
    const page = pages[0] || await puppeteerBrowser.newPage();
    
    // ✅ Guardar globalmente
    puppeteerPage = page;

    // Ocultar webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      delete window.chrome;
    });

    sendLog({
      type: "CF_NAVIGATING",
      message: `📍 Navegando a ${baseUrl}...`
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    sendLog({
      type: "CF_WAITING_USER",
      message: "⏳ Esperando que resuelvas el CAPTCHA..."
    });

    // Crear ventana de monitoreo
    const monitorWin = createMonitorWindow();

    // ✅ MÉTODO DIRECTO: Verificar cookies directamente desde Puppeteer
    const maxWaitTime = 300000; // 5 minutos
    const startTime = Date.now();
    let cookieCaptured = null;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Obtener TODAS las cookies directamente
        const allCookies = await page.cookies();
        const cfCookie = allCookies.find(c => c.name === 'cf_clearance');
        
        if (cfCookie && cfCookie.value && cfCookie.value.length > 20) {
          // ✅ ESPERAR 3 SEGUNDOS EXTRA para que Laravel genere sus cookies
          sendLog({
            type: "CF_WAITING_LARAVEL",
            message: "⏳ Cookie de Cloudflare detectada, esperando cookies de Laravel..."
          });
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // ✅ Recargar la página para forzar la generación de cookies de Laravel
          try {
            await page.reload({ waitUntil: 'networkidle2', timeout: 10000 });
            sendLog({
              type: "CF_PAGE_RELOADED",
              message: "🔄 Página recargada para obtener cookies de sesión"
            });
          } catch {}
          
          // ✅ Esperar otros 2 segundos
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // ✅ Capturar TODAS las cookies nuevamente
          const finalCookies = await page.cookies();
          
          // ✅ Capturar User-Agent
          const userAgent = await page.evaluate(() => navigator.userAgent);
          
          // ✅ Filtrar cookies de starwin.plus
          const starwinCookies = finalCookies.filter(c => 
            c.domain.includes('starwin.plus') || c.domain.includes('starwin')
          );

          sendLog({
            type: "CF_COOKIE_DETECTED",
            message: `✅ Cookie detectada! Capturando ${starwinCookies.length} cookies...`,
            cookieNames: starwinCookies.map(c => c.name).join(', ')
          });

          cookieCaptured = {
            cfClearance: {
              value: cfCookie.value,
              domain: cfCookie.domain,
              path: cfCookie.path,
              expires: cfCookie.expires
            },
            allCookies: starwinCookies.map(c => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: c.sameSite
            })),
            userAgent: userAgent
          };

          sendLog({
            type: "CF_CAPTURE_DETAILS",
            message: `📦 Capturadas ${starwinCookies.length} cookies`,
            cookies: starwinCookies.map(c => c.name).join(', '),
            userAgent: userAgent.substring(0, 60) + '...'
          });

          break;
        }

        // Log cada 10 segundos
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed % 10 === 0 && elapsed > 0) {
          sendLog({
            type: "CF_STILL_WAITING",
            message: `⏳ Esperando... (${elapsed}s)`
          });
        }

      } catch (err) {
        sendLog({
          type: "CF_CHECK_ERROR",
          message: `Error verificando: ${err.message}`
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Cerrar ventana de monitoreo
    if (monitorWin && !monitorWin.isDestroyed()) {
      monitorWin.close();
    }

    // ✅ NO navegar a about:blank - mantener en starwin.plus para que fetch() funcione
    // ❌ NO CERRAR EL NAVEGADOR - Dejarlo abierto para mantener la sesión
    if (puppeteerBrowser) {
      sendLog({
        type: "CF_BROWSER_READY",
        message: "🔵 Navegador listo para crear usuarios. Se cerrará al salir de la app."
      });
    }

    if (!cookieCaptured) {
      sendLog({
        type: "CF_TIMEOUT",
        message: "❌ Timeout: No se capturó la cookie en 5 minutos"
      });
      return { ok: false, error: "TIMEOUT" };
    }

    // ✅ Guardar TODO en config (sin sobrescribir adminUser/adminPass)
    sendLog({
      type: "CF_SAVING_DATA",
      message: `💾 Guardando ${cookieCaptured.allCookies.length} cookies...`
    });

    configStore.update({
      starwin: {
        ...starwin,  // ✅ Mantener todo lo que ya existe (incluyendo adminUser y adminPass)
        cfClearance: cookieCaptured.cfClearance.value,
        cfClearanceDomain: cookieCaptured.cfClearance.domain,
        cfClearancePath: cookieCaptured.cfClearance.path,
        cfClearanceUpdated: new Date().toISOString(),
        cfClearanceExpires: cookieCaptured.cfClearance.expires ? 
          new Date(cookieCaptured.cfClearance.expires * 1000).toISOString() : 
          new Date(Date.now() + 7200000).toISOString(),
        allCookies: cookieCaptured.allCookies,
        capturedUserAgent: cookieCaptured.userAgent
      }
    });

    sendLog({
      type: "STARWIN_CF_RENEW_OK",
      message: `🎉 ¡Listo! ${cookieCaptured.allCookies.length} cookies + User-Agent guardados`
    });

    // ✅ NUEVO: Actualizar UserCreator con la página de Puppeteer
    if (userCreator && puppeteerPage) {
      userCreator.setPuppeteerPage(puppeteerPage);
      sendLog({
        type: "PUPPETEER_LINKED",
        message: "🔗 UserCreator vinculado con navegador activo"
      });
    }

    return { 
      ok: true, 
      cookie: {
        value: cookieCaptured.cfClearance.value,
        totalCookies: cookieCaptured.allCookies.length
      }
    };

  } catch (error) {
    sendLog({
      type: "STARWIN_CF_RENEW_FAIL",
      message: `❌ Error: ${error.message}`
    });

    if (puppeteerBrowser) {
      try {
        await puppeteerBrowser.close();
      } catch {}
      puppeteerBrowser = null;
    }

    return { ok: false, error: error.message };
  }
}

function createMonitorWindow() {
  const win = new BrowserWindow({
    width: 450,
    height: 300,
    title: "Renovando Cloudflare...",
    resizable: false,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false
    }
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          color: #e2e8f0;
          padding: 40px;
          margin: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          text-align: center;
        }
        .spinner {
          width: 50px;
          height: 50px;
          border: 4px solid rgba(59, 130, 246, 0.3);
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        h2 {
          color: #3b82f6;
          margin: 0 0 15px 0;
        }
        p {
          color: #94a3b8;
          line-height: 1.6;
        }
        .highlight {
          color: #60a5fa;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="spinner"></div>
      <h2>🔐 Renovando Cloudflare</h2>
      <p>
        Resolvé el CAPTCHA en el navegador que se abrió.
        <br><br>
        La cookie se <span class="highlight">detectará automáticamente</span>.
        <br><br>
        <small>Esta ventana se cerrará sola...</small>
      </p>
    </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return win;
}

function findChromePath() {
  const paths = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    ]
  };

  const platform = process.platform;
  const candidates = paths[platform] || [];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

async function autoRenewCfIfNeeded(configStore) {
  if (!cfMaintainer) return { ok: false, error: "CF Maintainer no inicializado" };
  
  const check = cfMaintainer.checkAndRenewIfNeeded();
  
  if (check.needsRenewal && check.priority === "HIGH") {
    sendLog({
      type: "CF_AUTO_RENEW_NEEDED",
      message: `⚠️ Renovación necesaria: ${check.reason}. Hacé clic en 'Renovar CF'`
    });
    return { ok: false, reason: "MANUAL_REQUIRED" };
  }
  
  return { ok: true, reason: "NOT_NEEDED" };
}

function scheduleAutoRenewal(configStore) {
  setInterval(() => {
    autoRenewCfIfNeeded(configStore).catch(err => {
      console.error("Error en renovación automática:", err);
    });
  }, 30 * 60 * 1000);
  
  setTimeout(() => {
    autoRenewCfIfNeeded(configStore).catch(err => {
      console.error("Error en renovación inicial:", err);
    });
  }, 10000);
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  console.log(`[MAIN] userData path: ${userDataPath}`);

  const configStore = new ConfigStore({ basePath: userDataPath });
  
  // ✅ AGREGADO: Copiar credenciales de Google si no existen
  const credentialsDir = path.join(userDataPath, 'credentials');
  const credentialsFile = path.join(credentialsDir, 'credenciales.json');

  if (!fs.existsSync(credentialsDir)) {
    fs.mkdirSync(credentialsDir, { recursive: true });
  }

  if (!fs.existsSync(credentialsFile)) {
    const sourceCredentials = path.join(__dirname, 'credentials', 'credenciales.json');
    if (fs.existsSync(sourceCredentials)) {
      fs.copyFileSync(sourceCredentials, credentialsFile);
      console.log('[MAIN] Credenciales de Google copiadas');
    }
  }

  // Copiar configuración de sheets si no existe
  const configDir = path.join(userDataPath, 'config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const sheetsConfigFile = path.join(configDir, 'sheets-config.json');
  if (!fs.existsSync(sheetsConfigFile)) {
    const sourceSheetsConfig = path.join(__dirname, 'config', 'sheets-config.json');
    if (fs.existsSync(sourceSheetsConfig)) {
      fs.copyFileSync(sourceSheetsConfig, sheetsConfigFile);
      console.log('[MAIN] Configuración de Sheets copiada');
    }
  }

  // ✅ AGREGADO: Crear SheetsLogger
  sheetsLogger = new SheetsLogger({
    credentialsPath: credentialsFile,
    configPath: sheetsConfigFile,
    onLog: (log) => {
      console.log(`[${log.type}] ${log.message}`);
      sendLog(log);
    }
  });
  
  const sessionStore = new SessionStore({ basePath: userDataPath });
  sessionStore.cleanIncompleted();

  userCreator = new UserCreator({ configStore, onLog: sendLog });
  
  cfMaintainer = new CFMaintainer(configStore, sendLog);

  lineManager = new LineManager({
    basePath: userDataPath,
    onQr: (lineId, qrCode) => {
      mainWindow?.webContents.send("lines:qr", { lineId, qrCode });
    },
    onStatus: (lineId, status) => {
      mainWindow?.webContents.send("lines:status", { lineId, ...status });
    },
    onMessage: (lineId, message) => {
      mainWindow?.webContents.send("lines:message", { lineId, ...message });
    },
    onLog: sendLog
  });

  botEngine = new BotEngine({
    configStore,
    sessionStore,
    userCreator,
    cfMaintainer,
    sheetsLogger, // ✅ AGREGADO
    onSendMessage: async ({ lineId, to, text }) => {
      if (lineManager) {
        return await lineManager.sendMessage(lineId, to, text);
      }
      return { ok: false, error: "LineManager no inicializado" };
    },
    onLog: sendLog
  });

  lineManager.setEngine(botEngine);

  // IPC HANDLERS
  ipcMain.handle("lines:list", async () => {
    try {
      return await lineManager.listLines();
    } catch (error) {
      console.error("Error en lines:list:", error);
      return [];
    }
  });

  ipcMain.handle("lines:start", async (_e, lineId) => {
    try {
      return await lineManager.startLine(lineId);
    } catch (error) {
      console.error("Error en lines:start:", error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("lines:stop", async (_e, lineId) => {
    try {
      return await lineManager.stopLine(lineId);
    } catch (error) {
      console.error("Error en lines:stop:", error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("lines:status", async (_e, lineId) => {
    try {
      return await lineManager.getStatus(lineId);
    } catch (error) {
      console.error("Error en lines:status:", error);
      return { state: "ERROR", error: error.message };
    }
  });

  ipcMain.handle("config:get", async () => configStore.get());
  ipcMain.handle("config:set", async (_e, patch) => configStore.update(patch));
  ipcMain.handle("sessions:count", async () => sessionStore.countAll ? sessionStore.countAll() : sessionStore.count());

  ipcMain.handle("paths:get", async () => ({
    userData: userDataPath,
    configFile: path.join(userDataPath, "config", "bot-config.json"),
    configDir: path.join(userDataPath, "config")
  }));

  ipcMain.handle("config:open-folder", async () => {
    const configDir = path.join(userDataPath, "config");
    await shell.openPath(configDir);
    return { ok: true };
  });

  ipcMain.handle("starwin:renew-clearance", async () => {
    try {
      const res = await renewStarwinClearanceWithExtension(configStore);
      return res;
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("cf:auto-renew", async () => {
    const res = await autoRenewCfIfNeeded(configStore);
    return res;
  });

  ipcMain.handle("cf:status", async () => {
    if (!cfMaintainer) {
      return {
        hasCookie: false,
        lastUpdated: null,
        expires: null,
        needsRenewal: true,
        reason: "CF_MAINTAINER_NOT_INITIALIZED",
        status: "ERROR"
      };
    }
    
    const cfg = configStore.get();
    const starwin = cfg.starwin || {};
    const check = cfMaintainer.checkAndRenewIfNeeded();
    
    return {
      hasCookie: !!starwin.cfClearance,
      lastUpdated: starwin.cfClearanceUpdated || null,
      expires: starwin.cfClearanceExpires || null,
      needsRenewal: check.needsRenewal,
      reason: check.reason,
      status: check.needsRenewal ? "EXPIRED" : "VALID"
    };
  });

  // ✅ AGREGADO: Dashboard handlers
  ipcMain.handle('dashboard:get-stats', async () => {
    try {
      if (!sheetsLogger) {
        return {
          total: 0,
          today: 0,
          thisWeek: 0,
          deposited: 0,
          depositRate: 0,
          byLine: {}
        };
      }
      
      const result = await sheetsLogger.getStats();
      return result.stats || {
        total: 0,
        today: 0,
        thisWeek: 0,
        deposited: 0,
        depositRate: 0,
        byLine: {}
      };
    } catch (error) {
      console.error('[MAIN] Error getting stats:', error);
      return {
        total: 0,
        today: 0,
        thisWeek: 0,
        deposited: 0,
        depositRate: 0,
        byLine: {}
      };
    }
  });

  ipcMain.handle('dashboard:get-users-by-day', async (_event, days) => {
    try {
      if (!sheetsLogger) return [];
      
      const result = await sheetsLogger.getUsersByDay(days || 30);
      return result.data || [];
    } catch (error) {
      console.error('[MAIN] Error getting users by day:', error);
      return [];
    }
  });

  ipcMain.handle('dashboard:get-recent-users', async (_event, limit) => {
    try {
      if (!sheetsLogger) return [];
      
      const result = await sheetsLogger.getAllUsers();
      if (!result.ok) return [];
      
      // Ordenar por fecha (más recientes primero) y limitar
      const users = result.users
        .sort((a, b) => {
          const dateA = new Date(a.fecha.split(' ')[0].split('/').reverse().join('-'));
          const dateB = new Date(b.fecha.split(' ')[0].split('/').reverse().join('-'));
          return dateB - dateA;
        })
        .slice(0, limit || 10);
      
      return users;
    } catch (error) {
      console.error('[MAIN] Error getting recent users:', error);
      return [];
    }
  });

  createMainWindow();
  scheduleAutoRenewal(configStore);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on('will-quit', async () => {
  if (userCreator) {
    userCreator.clearPuppeteerPage();
  }
  if (puppeteerBrowser) {
    try {
      await puppeteerBrowser.close();
    } catch {}
  }
});