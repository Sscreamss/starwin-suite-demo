// bot/cfMaintainer.js
class CFMaintainer {
  constructor(configStore, onLog) {
    this.configStore = configStore;
    this.onLog = onLog;
    this.lastRenewal = null;
    this.renewalAttempts = 0;
  }

  checkAndRenewIfNeeded() {
    const cfg = this.configStore.get();
    const starwin = cfg.starwin || {};
    
    // Si no hay cookie, necesita renovación
    if (!starwin.cfClearance) {
      return { 
        needsRenewal: true, 
        reason: "NO_COOKIE",
        priority: "HIGH"
      };
    }

    // Verificar timestamp de última actualización
    if (!starwin.cfClearanceUpdated) {
      return { 
        needsRenewal: true, 
        reason: "NO_UPDATE_RECORD",
        priority: "MEDIUM"
      };
    }

    const lastUpdate = new Date(starwin.cfClearanceUpdated);
    const now = new Date();
    
    // Verificar si la fecha es válida
    if (isNaN(lastUpdate.getTime())) {
      return { 
        needsRenewal: true, 
        reason: "INVALID_TIMESTAMP",
        priority: "HIGH"
      };
    }

    const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

    // CF clearance normalmente dura 2 horas, renovar después de 1.5 horas
    if (hoursSinceUpdate > 1.5) {
      return { 
        needsRenewal: true, 
        reason: "EXPIRED",
        hours: hoursSinceUpdate.toFixed(2),
        priority: "HIGH"
      };
    }

    // Renovar si pasó más de 1 hora pero menos de 1.5 (mantenimiento preventivo)
    if (hoursSinceUpdate > 1) {
      return { 
        needsRenewal: true, 
        reason: "PREVENTIVE",
        hours: hoursSinceUpdate.toFixed(2),
        priority: "LOW"
      };
    }

    return { 
      needsRenewal: false, 
      reason: "VALID",
      hours: hoursSinceUpdate.toFixed(2),
      nextCheck: (1.5 - hoursSinceUpdate).toFixed(2)
    };
  }

  /**
   * ✅ NUEVO: Validación REAL — hace un request HTTP a Starwin para verificar
   * que la sesión de Puppeteer funciona de verdad.
   * Recibe la puppeteerPage como argumento.
   */
  async verifySessionIsAlive(puppeteerPage) {
    // 1) Sin Puppeteer → inválido seguro
    if (!puppeteerPage) {
      this._log("VERIFY", "❌ No hay puppeteerPage — sesión inválida");
      return { alive: false, reason: "NO_PUPPETEER_PAGE" };
    }

    // 2) Verificar que la página no esté cerrada
    try {
      const isClosed = puppeteerPage.isClosed();
      if (isClosed) {
        this._log("VERIFY", "❌ puppeteerPage está cerrada");
        return { alive: false, reason: "PAGE_CLOSED" };
      }
    } catch (e) {
      this._log("VERIFY", `❌ Error verificando si la página está cerrada: ${e.message}`);
      return { alive: false, reason: "PAGE_CHECK_ERROR" };
    }

    // 3) Verificar que estemos en starwin.plus
    try {
      const currentUrl = await puppeteerPage.url();
      if (!currentUrl.includes('starwin.plus')) {
        this._log("VERIFY", `❌ Página en URL incorrecta: ${currentUrl}`);
        return { alive: false, reason: "WRONG_URL" };
      }
    } catch (e) {
      this._log("VERIFY", `❌ Error obteniendo URL: ${e.message}`);
      return { alive: false, reason: "URL_ERROR" };
    }

    // 4) Request real: intentar obtener CSRF cookie (endpoint liviano)
    try {
      const cfg = this.configStore.get();
      const starwin = cfg.starwin || {};
      const baseUrl = starwin.baseUrl || "https://admin.starwin.plus";
      const origin = new URL(baseUrl).origin;
      const csrfUrl = `${origin}${starwin.csrfPath || "/api/sanctum/csrf-cookie"}`;

      const result = await puppeteerPage.evaluate(async (url) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });
          return { status: response.status, ok: response.ok };
        } catch (fetchErr) {
          return { status: 0, ok: false, error: fetchErr.message };
        }
      }, csrfUrl);

      if (result.status === 204 || result.status === 200) {
        this._log("VERIFY", `✅ Sesión válida (CSRF respondió ${result.status})`);
        return { alive: true, reason: "CSRF_OK", status: result.status };
      } else if (result.status === 403) {
        this._log("VERIFY", "❌ Cloudflare bloqueó el request (403) — cookie expirada");
        return { alive: false, reason: "CF_BLOCKED_403" };
      } else {
        this._log("VERIFY", `⚠️ CSRF respondió con status ${result.status} — posible problema`);
        // Status 500, 502, etc. = problema del servidor, no de CF. Considerar como alive
        if (result.status >= 500) {
          return { alive: true, reason: "SERVER_ERROR_BUT_CF_OK", status: result.status };
        }
        return { alive: false, reason: `UNEXPECTED_STATUS_${result.status}`, status: result.status };
      }
    } catch (e) {
      this._log("VERIFY", `❌ Error en request de verificación: ${e.message}`);
      return { alive: false, reason: "VERIFY_REQUEST_ERROR", error: e.message };
    }
  }

  getStatus() {
    const cfg = this.configStore.get();
    const starwin = cfg.starwin || {};
    const check = this.checkAndRenewIfNeeded();
    
    return {
      hasCookie: !!starwin.cfClearance,
      cookieLength: starwin.cfClearance ? starwin.cfClearance.length : 0,
      lastUpdated: starwin.cfClearanceUpdated,
      expires: starwin.cfClearanceExpires,
      needsRenewal: check.needsRenewal,
      reason: check.reason,
      status: check.needsRenewal ? "NEEDS_RENEWAL" : "VALID",
      priority: check.priority || "N/A",
      renewalAttempts: this.renewalAttempts,
      lastRenewal: this.lastRenewal
    };
  }

  resetAttempts() {
    this.renewalAttempts = 0;
  }

  incrementAttempts() {
    this.renewalAttempts++;
    this.lastRenewal = new Date().toISOString();
  }

  _log(type, message, extra = {}) {
    this.onLog?.({ 
      at: new Date().toISOString(), 
      type: `CF_${type}`, 
      message,
      ...extra 
    });
    console.log(`[CFMaintainer] ${message}`);
  }
}

module.exports = { CFMaintainer };