const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const { ConfigStore } = require("./bot/configStore");
const { SessionStore } = require("./bot/sessionStore");
const { UserCreator } = require("./bot/userCreator");
const { BotEngine } = require("./bot/engine");
const { CFMaintainer } = require("./bot/cfMaintainer");
const { LineManager } = require("./whatsapp/lineManager");
const { SheetsLogger } = require("./bot/sheetsLogger");
const { setupAutoUpdater } = require("./autoUpdater");

let mainWindow = null;
let cfMaintainer = null;
let lineManager = null;
let botEngine = null;
let puppeteerBrowser = null;
let puppeteerPage = null;
let userCreator = null;
let sheetsLogger = null;
let autoRenewInProgress = false; // ✅ NUEVO: Lock para evitar renovaciones simultáneas
let autoRenewIntervalRef = null; // ✅ NUEVO: Referencia al intervalo para poder reiniciarlo

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
    minWidth: 900,
    minHeight: 600,
    frame: false,           // ✅ Sin barra nativa de Windows
    titleBarStyle: 'hidden', 
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'icon.png'),
    title: 'BotDash'
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
        ...starwin,
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

    // ✅ Actualizar UserCreator con la página de Puppeteer
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

// ✅ MODIFICADO: Ahora ejecuta la renovación automáticamente en vez de pedir manual
async function autoRenewCfIfNeeded(configStore) {
  if (!cfMaintainer) return { ok: false, error: "CF Maintainer no inicializado" };
  
  // Evitar ejecuciones simultáneas
  if (autoRenewInProgress) {
    sendLog({
      type: "CF_AUTO_RENEW_SKIP",
      message: "⏳ Renovación ya en progreso, saltando..."
    });
    return { ok: false, reason: "ALREADY_IN_PROGRESS" };
  }

  const check = cfMaintainer.checkAndRenewIfNeeded();
  
  if (!check.needsRenewal) {
    // ✅ NUEVO: El timer dice que la cookie no expiró, pero verificar que la sesión
    // de Puppeteer realmente funcione con un request real
    sendLog({
      type: "CF_AUTO_RENEW_VERIFYING",
      message: `🔍 Timer dice CF válido (${check.hours}h), verificando sesión real...`
    });

    const sessionCheck = await cfMaintainer.verifySessionIsAlive(puppeteerPage);

    if (sessionCheck.alive) {
      sendLog({
        type: "CF_AUTO_RENEW_CHECK",
        message: `✅ CF válido y sesión funcional (${sessionCheck.reason}). Próxima en ~${check.nextCheck}h`
      });
      return { ok: true, reason: "NOT_NEEDED" };
    } else {
      // Sesión muerta aunque el timer diga que la cookie es válida → forzar renovación
      sendLog({
        type: "CF_SESSION_DEAD",
        message: `⚠️ Timer dice válido pero sesión muerta (${sessionCheck.reason}). Forzando renovación...`
      });
      // Continuar abajo para renovar
    }
  } else {
    sendLog({
      type: "CF_AUTO_RENEW_NEEDED",
      message: `🔄 CF necesita renovación - Razón: ${check.reason} (${check.priority})`
    });
  }

  // Si llegamos acá, necesita renovación (sea por timer o por sesión muerta)
  sendLog({
    type: "CF_AUTO_RENEW_STARTING",
    message: "🔄 Renovación automática iniciada..."
  });

  autoRenewInProgress = true;

  // Notificar al frontend que empezó la renovación
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("cf:auto-renew-status", { status: "renewing" });
  }

  try {
    const result = await renewStarwinClearanceWithExtension(configStore);
    
    if (result.ok) {
      cfMaintainer.resetAttempts();
      sendLog({
        type: "CF_AUTO_RENEW_SUCCESS",
        message: `✅ Renovación automática exitosa - ${result.cookie?.totalCookies || 0} cookies capturadas`
      });
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("cf:auto-renewed", { ok: true });
        mainWindow.webContents.send("cf:auto-renew-status", { status: "idle" });
      }
      
      return { ok: true, reason: "RENEWED_AUTOMATICALLY" };
    } else {
      cfMaintainer.incrementAttempts();
      sendLog({
        type: "CF_AUTO_RENEW_FAILED",
        message: `❌ Renovación automática falló: ${result.error || "unknown"}. Intento #${cfMaintainer.renewalAttempts}`
      });

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("cf:auto-renew-status", { status: "idle" });
      }

      return { ok: false, reason: "RENEWAL_FAILED", error: result.error };
    }
  } catch (error) {
    cfMaintainer.incrementAttempts();
    sendLog({
      type: "CF_AUTO_RENEW_ERROR",
      message: `❌ Error en renovación automática: ${error.message}. Intento #${cfMaintainer.renewalAttempts}`
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cf:auto-renew-status", { status: "idle" });
    }

    return { ok: false, reason: "RENEWAL_ERROR", error: error.message };
  } finally {
    autoRenewInProgress = false;
  }
}

// ✅ NUEVO: Obtener el intervalo configurable (en minutos) desde config
function getAutoRenewInterval(configStore) {
  const cfg = configStore.get();
  const minutes = cfg.autoRenewIntervalMinutes || 15; // Default 15 minutos
  return Math.max(1, Math.min(120, minutes)); // Clamp entre 1 y 120 minutos
}

// ✅ MODIFICADO: Intervalo configurable + notifica al frontend el countdown
function scheduleAutoRenewal(configStore) {
  const intervalMinutes = getAutoRenewInterval(configStore);
  const intervalMs = intervalMinutes * 60 * 1000;
  const INITIAL_DELAY = 15000; // 15 segundos después de iniciar la app

  sendLog({
    type: "CF_AUTO_RENEW_SCHEDULED",
    message: `⏰ Renovación automática programada cada ${intervalMinutes} minutos`
  });

  // Limpiar intervalo anterior si existe
  if (autoRenewIntervalRef) {
    clearInterval(autoRenewIntervalRef);
  }

  // Notificar al frontend el intervalo configurado
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("cf:timer-config", { intervalMinutes });
  }

  // Ejecutar cada X minutos
  autoRenewIntervalRef = setInterval(() => {
    sendLog({
      type: "CF_AUTO_RENEW_TICK",
      message: "🔍 Verificación periódica de CF..."
    });

    // Notificar al frontend que se resetea el timer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cf:timer-reset", { intervalMinutes });
    }

    autoRenewCfIfNeeded(configStore).catch(err => {
      console.error("Error en renovación automática:", err);
      sendLog({
        type: "CF_AUTO_RENEW_INTERVAL_ERROR",
        message: `❌ Error en intervalo de renovación: ${err.message}`
      });
    });
  }, intervalMs);

  // Primera verificación al iniciar — ✅ FORZAR renovación para restaurar sesión de Puppeteer
  setTimeout(() => {
    sendLog({
      type: "CF_AUTO_RENEW_INITIAL",
      message: "🚀 Renovando CF al arrancar (restaurar sesión de Puppeteer)..."
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cf:timer-reset", { intervalMinutes });
    }

    // Forzar renovación siempre al iniciar, porque puppeteerPage se pierde al cerrar la app
    autoRenewInProgress = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cf:auto-renew-status", { status: "renewing" });
    }

    renewStarwinClearanceWithExtension(configStore).then(result => {
      if (result.ok) {
        cfMaintainer.resetAttempts();
        sendLog({
          type: "CF_STARTUP_RENEW_SUCCESS",
          message: `✅ Sesión de Puppeteer restaurada al iniciar - ${result.cookie?.totalCookies || 0} cookies`
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("cf:auto-renewed", { ok: true });
        }
      } else {
        sendLog({
          type: "CF_STARTUP_RENEW_FAILED",
          message: `⚠️ No se pudo restaurar sesión al iniciar: ${result.error || "unknown"}`
        });
      }
      autoRenewInProgress = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("cf:auto-renew-status", { status: "idle" });
      }
    }).catch(err => {
      console.error("Error en renovación inicial:", err);
      autoRenewInProgress = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("cf:auto-renew-status", { status: "idle" });
      }
    });
  }, INITIAL_DELAY);
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  console.log(`[MAIN] userData path: ${userDataPath}`);

  // ═══════════════════════════════════════
  // ✅ LIMPIEZA POST-UPDATE: Si la versión cambió, limpiar cache de sesiones
  // ═══════════════════════════════════════
  const currentVersion = app.getVersion();
  const versionFile = path.join(userDataPath, '.last-version');
  let lastVersion = null;

  try {
    if (fs.existsSync(versionFile)) {
      lastVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    }
  } catch {}

  if (lastVersion && lastVersion !== currentVersion) {
    console.log(`[MAIN] ⬆️ Actualización detectada: v${lastVersion} → v${currentVersion}`);
    
    // Limpiar cache de wwebjs (no borra auth, solo cache del browser)
    const sessionsDir = path.join(userDataPath, 'sessions');
    if (fs.existsSync(sessionsDir)) {
      const entries = fs.readdirSync(sessionsDir);
      for (const entry of entries) {
        const entryPath = path.join(sessionsDir, entry);
        
        // Solo limpiar carpetas de sesión de líneas (session-lineXXX)
        if (!fs.statSync(entryPath).isDirectory()) continue;
        
        // Buscar carpetas de cache dentro de cada sesión
        const cacheDirs = ['Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Default/Service Worker'];
        for (const cacheSubDir of cacheDirs) {
          const cachePath = path.join(entryPath, cacheSubDir);
          if (fs.existsSync(cachePath)) {
            try {
              fs.rmSync(cachePath, { recursive: true, force: true });
              console.log(`[MAIN] 🧹 Cache limpiado: ${cachePath}`);
            } catch (e) {
              console.log(`[MAIN] ⚠️ No se pudo limpiar ${cachePath}: ${e.message}`);
            }
          }
        }
      }
      console.log(`[MAIN] ✅ Limpieza post-update completada`);
    }

    // Limpiar sesiones de bot (estados incompletos)
    const sessionsFile = path.join(sessionsDir, 'sessions.json');
    if (fs.existsSync(sessionsFile)) {
      try {
        fs.writeFileSync(sessionsFile, JSON.stringify({}, null, 2), 'utf-8');
        console.log('[MAIN] 🧹 Sesiones de bot reseteadas post-update');
      } catch (e) {
        console.log(`[MAIN] ⚠️ No se pudo resetear sessions.json: ${e.message}`);
      }
    }
  }

  // Guardar versión actual
  try {
    fs.writeFileSync(versionFile, currentVersion, 'utf-8');
  } catch {}

  const configStore = new ConfigStore({ basePath: userDataPath });
  
  // Copiar credenciales de Google si no existen
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

  // Crear SheetsLogger
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
    sheetsLogger,
    onSendMessage: async ({ lineId, to, text }) => {
      if (lineManager) {
        return await lineManager.sendMessage(lineId, to, text);
      }
      return { ok: false, error: "LineManager no inicializado" };
    },
    // ✅ NUEVO: Handler para enviar imágenes
    onSendImage: async ({ lineId, to, imagePath, caption }) => {
      if (lineManager) {
        return await lineManager.sendImage(lineId, to, imagePath, caption);
      }
      return { ok: false, error: "LineManager no inicializado" };
    },
    onLog: sendLog
  });

  lineManager.setEngine(botEngine);

  // IPC HANDLERS

  // ✅ Window controls (titlebar custom)
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle("app:is-packaged", () => app.isPackaged);
  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("lines:list", async () => {
    try {
      return await lineManager.listLines();
    } catch (error) {
      console.error("Error en lines:list:", error);
      return [];
    }
  });

  ipcMain.handle("lines:start", async (_e, lineId, options = {}) => {
    try {
      return await lineManager.startLine(lineId, options);
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

  // ✅ NUEVO: Persistencia de nombres de líneas
  const lineNamesFile = path.join(userDataPath, "config", "line-names.json");

  function loadLineNames() {
    try {
      if (fs.existsSync(lineNamesFile)) {
        return JSON.parse(fs.readFileSync(lineNamesFile, "utf-8"));
      }
    } catch (e) {
      console.error("[MAIN] Error leyendo line-names.json:", e.message);
    }
    return {};
  }

  function saveLineNames(names) {
    try {
      const dir = path.dirname(lineNamesFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(lineNamesFile, JSON.stringify(names, null, 2), "utf-8");
    } catch (e) {
      console.error("[MAIN] Error guardando line-names.json:", e.message);
    }
  }

  ipcMain.handle("lines:get-names", async () => {
    return loadLineNames();
  });

  ipcMain.handle("lines:set-name", async (_e, lineId, name) => {
    const names = loadLineNames();
    if (name && name.trim()) {
      names[lineId] = name.trim();
    } else {
      delete names[lineId];
    }
    saveLineNames(names);
    return { ok: true, names };
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

    // ✅ Si el timer dice válido, verificar sesión real
    let sessionAlive = false;
    if (!check.needsRenewal) {
      const sessionCheck = await cfMaintainer.verifySessionIsAlive(puppeteerPage);
      sessionAlive = sessionCheck.alive;
    }

    const reallyValid = !check.needsRenewal && sessionAlive;
    
    return {
      hasCookie: !!starwin.cfClearance,
      lastUpdated: starwin.cfClearanceUpdated || null,
      expires: starwin.cfClearanceExpires || null,
      needsRenewal: !reallyValid,
      reason: reallyValid ? check.reason : (sessionAlive ? check.reason : "SESSION_DEAD"),
      status: reallyValid ? "VALID" : "EXPIRED"
    };
  });

  // ✅ NUEVO: Obtener intervalo de auto-renew
  ipcMain.handle("cf:get-auto-renew-interval", async () => {
    return getAutoRenewInterval(configStore);
  });

  // ✅ NUEVO: Cambiar intervalo de auto-renew
  ipcMain.handle("cf:set-auto-renew-interval", async (_e, minutes) => {
    const clamped = Math.max(1, Math.min(120, parseInt(minutes) || 15));
    configStore.update({ autoRenewIntervalMinutes: clamped });
    
    sendLog({
      type: "CF_INTERVAL_CHANGED",
      message: `⏰ Intervalo de renovación cambiado a ${clamped} minutos`
    });

    // Reiniciar el scheduler con el nuevo intervalo
    scheduleAutoRenewal(configStore);
    
    return { ok: true, interval: clamped };
  });

  // Dashboard handlers
  ipcMain.handle('dashboard:get-stats', async () => {
    try {
      if (!sheetsLogger) {
        return {
          total: 0,
          today: 0,
          thisWeek: 0,
          deposited: 0,
          depositedToday: 0,
          depositedThisWeek: 0,
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
        depositedToday: 0,
        depositedThisWeek: 0,
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
        depositedToday: 0,
        depositedThisWeek: 0,
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
      
      // ✅ FIX: Parsear fechas DD/MM/YYYY correctamente (split por coma, no espacio)
      function parseSheetDate(fecha) {
        if (!fecha) return new Date(0);
        const datePart = fecha.split(',')[0].trim(); // "24/02/2026"
        const parts = datePart.split('/');
        if (parts.length !== 3) return new Date(0);
        const [day, month, year] = parts.map(Number);
        return new Date(year, month - 1, day);
      }

      const users = result.users
        .sort((a, b) => parseSheetDate(b.fecha) - parseSheetDate(a.fecha))
        .slice(0, limit || 10);
      
      return users;
    } catch (error) {
      console.error('[MAIN] Error getting recent users:', error);
      return [];
    }
  });

  // ✅ NUEVO: Obtener TODOS los usuarios para el dashboard avanzado
  ipcMain.handle('dashboard:get-all-users', async () => {
    try {
      if (!sheetsLogger) return [];
      const result = await sheetsLogger.getAllUsers();
      return result.ok ? result.users : [];
    } catch (error) {
      console.error('[MAIN] Error getting all users:', error);
      return [];
    }
  });

  // ✅ NUEVO: Seleccionar imagen de depósito
  ipcMain.handle("config:select-deposit-image", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Seleccionar imagen de depósito",
      filters: [
        { name: "Imágenes", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }
      ],
      properties: ["openFile"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, reason: "CANCELLED" };
    }

    const sourcePath = result.filePaths[0];
    const ext = path.extname(sourcePath);
    const destDir = path.join(userDataPath, "config", "images");
    
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const destPath = path.join(destDir, `deposit-image${ext}`);

    // Copiar imagen a la carpeta de config
    fs.copyFileSync(sourcePath, destPath);

    // Guardar ruta en config
    const currentCfg = configStore.get();
    configStore.update({
      createUser: {
        ...currentCfg.createUser,
        depositImagePath: destPath
      }
    });

    sendLog({
      type: "CONFIG_DEPOSIT_IMAGE",
      message: `📷 Imagen de depósito configurada: ${path.basename(destPath)}`
    });

    return { ok: true, path: destPath, name: path.basename(sourcePath) };
  });

  // ✅ NUEVO: Borrar imagen de depósito
  ipcMain.handle("config:remove-deposit-image", async () => {
    const cfg = configStore.get();
    const imagePath = cfg.createUser?.depositImagePath;

    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch {}
    }

    configStore.update({
      createUser: {
        ...cfg.createUser,
        depositImagePath: ""
      }
    });

    sendLog({
      type: "CONFIG_DEPOSIT_IMAGE_REMOVED",
      message: "🗑️ Imagen de depósito eliminada"
    });

    return { ok: true };
  });

  // ✅ NUEVO: Obtener info de la imagen de depósito
  ipcMain.handle("config:get-deposit-image", async () => {
    const cfg = configStore.get();
    const imagePath = cfg.createUser?.depositImagePath;

    if (imagePath && fs.existsSync(imagePath)) {
      const base64 = fs.readFileSync(imagePath).toString("base64");
      const ext = path.extname(imagePath).replace(".", "").toLowerCase();
      const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
      const mime = mimeMap[ext] || "image/jpeg";
      
      return {
        ok: true,
        path: imagePath,
        name: path.basename(imagePath),
        dataUrl: `data:${mime};base64,${base64}`
      };
    }

    return { ok: false, reason: "NO_IMAGE" };
  });

  createMainWindow();

  // ✅ Auto-updater solo en app empaquetada (.exe)
  if (app.isPackaged) {
    setupAutoUpdater(mainWindow, sendLog);
  } else {
    sendLog({
      type: "AUTO_UPDATE",
      message: "Modo desarrollo detectado: auto-updater deshabilitado"
    });
  }

  scheduleAutoRenewal(configStore);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on('will-quit', async () => {
  if (autoRenewIntervalRef) {
    clearInterval(autoRenewIntervalRef);
  }
  if (userCreator) {
    userCreator.clearPuppeteerPage();
  }
  if (puppeteerBrowser) {
    try {
      await puppeteerBrowser.close();
    } catch {}
  }
});
