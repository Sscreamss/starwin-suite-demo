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

  async verifyCookieValidity() {
    const cfg = this.configStore.get();
    const starwin = cfg.starwin || {};
    
    if (!starwin.cfClearance) {
      return { valid: false, reason: "NO_COOKIE" };
    }

    try {
      // Simular verificación (en la práctica esto se haría con una request real)
      // Por ahora, basarnos en el timestamp
      if (starwin.cfClearanceUpdated) {
        const lastUpdate = new Date(starwin.cfClearanceUpdated);
        const now = new Date();
        
        if (isNaN(lastUpdate.getTime())) {
          return { valid: false, reason: "INVALID_TIMESTAMP" };
        }
        
        const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);
        
        return {
          valid: hoursSinceUpdate < 2,
          hoursSinceUpdate: hoursSinceUpdate.toFixed(2),
          expiresIn: (2 - hoursSinceUpdate).toFixed(2)
        };
      }
      
      return { valid: false, reason: "NO_TIMESTAMP" };
    } catch (error) {
      this._log("CF_VERIFY_ERROR", `Error verificando cookie: ${error.message}`);
      return { valid: false, reason: "VERIFICATION_ERROR", error: error.message };
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