// background.js - Captura cookies de Cloudflare automáticamente

let cookieCaptured = false;
let electronPort = null;

// Escuchar cuando el usuario navega a starwin.plus
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('starwin.plus')) {
    console.log('[CF Capture] Tab loaded:', tab.url);
    checkForCookie();
  }
});

// Escuchar cambios en cookies
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie.name === 'cf_clearance' && 
      changeInfo.cookie.domain.includes('starwin.plus') &&
      !changeInfo.removed) {
    console.log('[CF Capture] cf_clearance cookie detected!');
    captureCookie();
  }
});

// Verificar si ya existe la cookie
async function checkForCookie() {
  try {
    const cookies = await chrome.cookies.getAll({
      domain: '.starwin.plus',
      name: 'cf_clearance'
    });

    if (cookies.length > 0 && cookies[0].value) {
      console.log('[CF Capture] Cookie found:', cookies[0].value.substring(0, 20) + '...');
      await sendCookieToElectron(cookies[0]);
    }
  } catch (error) {
    console.error('[CF Capture] Error checking cookie:', error);
  }
}

// Capturar la cookie cuando aparece
async function captureCookie() {
  if (cookieCaptured) return;

  try {
    const cookies = await chrome.cookies.getAll({
      domain: '.starwin.plus',
      name: 'cf_clearance'
    });

    if (cookies.length > 0 && cookies[0].value) {
      cookieCaptured = true;
      await sendCookieToElectron(cookies[0]);
    }
  } catch (error) {
    console.error('[CF Capture] Error capturing cookie:', error);
  }
}

// Enviar cookie a Electron
async function sendCookieToElectron(cookie) {
  // ✅ Capturar TODAS las cookies del dominio
  const allCookies = await chrome.cookies.getAll({
    domain: '.starwin.plus'
  });

  // ✅ Obtener User-Agent actual del navegador
  const userAgent = navigator.userAgent;

  const cookieData = {
    // Cookie principal de Cloudflare
    cfClearance: {
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate
    },
    // TODAS las cookies (incluye XSRF-TOKEN, laravel_session, etc.)
    allCookies: allCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expirationDate,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite
    })),
    // User-Agent del navegador que resolvió el CAPTCHA
    userAgent: userAgent,
    timestamp: new Date().toISOString()
  };

  console.log('[CF Capture] Sending full cookie data to Electron:', {
    cfClearance: cookieData.cfClearance.value.substring(0, 20) + '...',
    totalCookies: cookieData.allCookies.length,
    userAgent: cookieData.userAgent.substring(0, 50) + '...'
  });

  // Guardar en storage local para que Electron lo lea
  await chrome.storage.local.set({ 
    cfClearance: cookieData,
    captured: true,
    capturedAt: Date.now()
  });

  // Mostrar notificación visual
  showSuccessNotification();

  // Intentar cerrar la pestaña después de 2 segundos
  setTimeout(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://admin.starwin.plus/*' });
    if (tabs.length > 0) {
      chrome.tabs.remove(tabs[0].id);
    }
  }, 2000);
}

// Mostrar notificación de éxito
function showSuccessNotification() {
  chrome.tabs.query({ url: 'https://admin.starwin.plus/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        type: 'COOKIE_CAPTURED',
        message: '✅ Cookie capturada exitosamente' 
      });
    }
  });
}

// Escuchar mensajes del content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_COOKIE') {
    checkForCookie();
    sendResponse({ ok: true });
  }
  return true;
});

// Limpiar flag cuando se cierra el navegador
chrome.runtime.onStartup.addListener(() => {
  cookieCaptured = false;
});

console.log('[CF Capture] Extension loaded and ready');
