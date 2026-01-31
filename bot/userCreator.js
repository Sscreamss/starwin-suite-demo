// bot/userCreator.js
const fs = require("fs");
const path = require("path");

class UserCreator {
  constructor({ configStore, onLog, puppeteerPage }) {
    this.configStore = configStore;
    this.onLog = onLog;
    this.puppeteerPage = puppeteerPage; // ✅ NUEVO: Recibe la página de Puppeteer
  }

  _log(type, message, extra) {
    this.onLog?.({ at: new Date().toISOString(), type, message, ...(extra || {}) });
    console.log(`[UserCreator] ${message}`);
  }

  _getStarwinCfg() {
    const cfg = this.configStore.get();
    const starwin = cfg.starwin || {};
    const baseUrl = starwin.baseUrl || "https://admin.starwin.plus";
    const origin = new URL(baseUrl).origin;

    return {
      ...starwin,
      baseUrl,
      origin,
      csrfPath: starwin.csrfPath || "/api/sanctum/csrf-cookie",
      loginPath: starwin.loginPath || "/api/admin/login",
      createUserPath: starwin.createUserPath || "/api/admin/user/register"
    };
  }

  // ✅ NUEVO: Hacer request con CSRF token
  async _makeRequestWithCsrf(method, url, data, csrfToken) {
    if (!this.puppeteerPage) {
      throw new Error("Puppeteer page no disponible. Renovar Cloudflare primero.");
    }

    try {
      // ✅ Verificar que estamos en la página correcta
      const currentUrl = await this.puppeteerPage.url();
      
      if (!currentUrl.includes('starwin.plus')) {
        this._log("PAGE_WRONG_URL", `⚠️ Página en URL incorrecta: ${currentUrl}. Navegando a starwin.plus...`);
        
        const starwin = this._getStarwinCfg();
        await this.puppeteerPage.goto(starwin.origin, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        this._log("PAGE_NAVIGATED", "✅ Navegado de vuelta a starwin.plus");
      }

      const result = await this.puppeteerPage.evaluate(async (args) => {
        const { method, url, data, csrfToken } = args;
        
        const options = {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include'
        };

        // ✅ Agregar X-XSRF-TOKEN si existe
        if (csrfToken) {
          options.headers['X-XSRF-TOKEN'] = csrfToken;
        }

        if (data) {
          options.body = JSON.stringify(data);
        }

        try {
          const response = await fetch(url, options);
          const text = await response.text();
          
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}

          return {
            status: response.status,
            ok: response.ok,
            data: json,
            text: text.substring(0, 500)
          };
        } catch (fetchError) {
          return {
            status: 0,
            ok: false,
            error: fetchError.message || 'Fetch failed',
            text: ''
          };
        }
      }, { method, url, data, csrfToken });

      if (result.status === 0 && result.error) {
        throw new Error(`Fetch error: ${result.error}`);
      }

      return result;
    } catch (error) {
      this._log("REQUEST_ERROR", `Error en request: ${error.message}`);
      throw error;
    }
  }

  // ✅ NUEVO: Usar Puppeteer en vez de axios
  async _makeRequest(method, url, data = null) {
    if (!this.puppeteerPage) {
      throw new Error("Puppeteer page no disponible. Renovar Cloudflare primero.");
    }

    try {
      // ✅ Verificar que estamos en la página correcta
      const currentUrl = await this.puppeteerPage.url();
      
      if (!currentUrl.includes('starwin.plus')) {
        this._log("PAGE_WRONG_URL", `⚠️ Página en URL incorrecta: ${currentUrl}. Navegando a starwin.plus...`);
        
        // Navegar de vuelta a starwin.plus
        const starwin = this._getStarwinCfg();
        await this.puppeteerPage.goto(starwin.origin, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Esperar 2 segundos para que cargue
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        this._log("PAGE_NAVIGATED", "✅ Navegado de vuelta a starwin.plus");
      }

      const result = await this.puppeteerPage.evaluate(async (args) => {
        const { method, url, data } = args;
        
        const options = {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include' // Importante para enviar cookies
        };

        if (data) {
          options.body = JSON.stringify(data);
        }

        try {
          const response = await fetch(url, options);
          const text = await response.text();
          
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}

          return {
            status: response.status,
            ok: response.ok,
            data: json,
            text: text.substring(0, 500) // Limitar texto
          };
        } catch (fetchError) {
          return {
            status: 0,
            ok: false,
            error: fetchError.message || 'Fetch failed',
            text: ''
          };
        }
      }, { method, url, data });

      // ✅ Verificar si fetch falló
      if (result.status === 0 && result.error) {
        throw new Error(`Fetch error: ${result.error}`);
      }

      return result;
    } catch (error) {
      this._log("REQUEST_ERROR", `Error en request: ${error.message}`);
      throw error;
    }
  }

  async _getCsrfCookie(starwin) {
    this._log("CSRF", "Obteniendo CSRF cookie...");

    try {
      const result = await this._makeRequest('GET', `${starwin.origin}${starwin.csrfPath}`);
      
      if (result.status === 204 || result.status === 200) {
        this._log("CSRF", `✅ CSRF ok (status: ${result.status})`);
        
        // ✅ Obtener el token CSRF de las cookies
        const csrfToken = await this._getXsrfToken();
        if (csrfToken) {
          this._log("CSRF", `✅ XSRF-TOKEN obtenido: ${csrfToken.substring(0, 20)}...`);
          return csrfToken;
        } else {
          this._log("CSRF", "⚠️ XSRF-TOKEN no encontrado en cookies");
          return null;
        }
      } else if (result.status === 403) {
        throw new Error("Cloudflare bloqueó CSRF");
      } else {
        throw new Error(`CSRF failed with status ${result.status}`);
      }
    } catch (e) {
      this._log("CSRF_ERR", `Error en CSRF: ${e.message}`);
      const err = new Error("Cloudflare challenge bloqueó CSRF");
      err.code = "CF_BLOCKED";
      err.needRenewCfClearance = true;
      throw err;
    }
  }

  // ✅ NUEVO: Obtener XSRF-TOKEN de las cookies
  async _getXsrfToken() {
    if (!this.puppeteerPage) return null;

    try {
      const cookies = await this.puppeteerPage.cookies();
      const xsrfCookie = cookies.find(c => c.name === 'XSRF-TOKEN');
      
      if (xsrfCookie && xsrfCookie.value) {
        // Decodificar el valor (viene URL-encoded)
        return decodeURIComponent(xsrfCookie.value);
      }
      
      return null;
    } catch (error) {
      this._log("XSRF_ERR", `Error obteniendo XSRF-TOKEN: ${error.message}`);
      return null;
    }
  }

  async _login(starwin, { username, password }, csrfToken) {
    this._log("LOGIN", "Intentando login...");

    try {
      const result = await this._makeRequestWithCsrf(
        'POST',
        `${starwin.origin}${starwin.loginPath}`,
        {
          username,
          password,
          domain: starwin.domain || "admin.starwin.plus"
        },
        csrfToken
      );

      if (result.ok) {
        this._log("LOGIN", `✅ Login OK (status: ${result.status})`);
        return true;
      } else if (result.status === 401) {
        throw new Error("Credenciales incorrectas (401)");
      } else if (result.status === 419) {
        throw new Error("CSRF token inválido o expirado (419)");
      } else if (result.status === 403) {
        const err = new Error("Cloudflare bloqueó login");
        err.code = "CF_BLOCKED";
        err.needRenewCfClearance = true;
        throw err;
      } else {
        throw new Error(`Login failed with status ${result.status}`);
      }
    } catch (e) {
      this._log("LOGIN_ERR", `Error en login: ${e.message}`);
      throw e;
    }
  }

  async _createUser(starwin, { name, suffix, fixedPassword }, csrfToken) {
    const base = String(name || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z ]/g, "")
      .split(" ")[0] || "user";

    const rand = Math.floor(1000 + Math.random() * 9000);
    const username = `${base}${rand}${suffix || ""}`;
    const password = fixedPassword || `Starwin${rand}!`;
    const email = `${username}@admin.starwin.plus`;

    // ✅ Obtener valores de configuración con fallbacks
    const userType = starwin.userType || 13;
    const clientId = starwin.clientId || 40000004;
    const currencyId = starwin.currencyId || 8;
    const infiniteagent = starwin.infiniteagent !== undefined ? starwin.infiniteagent : true;

    // ✅ Estructura completa del formulario
    const payload = {
      form: {
        userType: userType,
        clientId: clientId,
        currencyId: currencyId,
        infiniteagent: infiniteagent,
        permissions: [],
        auth: {
          nickname: username,
          email: email,
          password: password
        },
        user: {
          client: clientId,
          firstname: "",
          lastname: "",
          country: "",
          date_birth: new Date().toISOString().split('T')[0], // Fecha actual YYYY-MM-DD
          phone: "",
          document: ""
        }
      }
    };

    this._log("CREATE", `👤 Creando usuario: ${username}`);
    this._log("CREATE_PAYLOAD", `Payload: userType=${userType}, clientId=${clientId}, currencyId=${currencyId}`);

    try {
      const result = await this._makeRequestWithCsrf(
        'POST',
        `${starwin.origin}${starwin.createUserPath}`,
        payload,
        csrfToken
      );

      if (result.ok) {
        this._log("CREATE", `✅ Usuario creado (status: ${result.status})`);
        return { username, password, email, raw: result.data };
      } else if (result.status === 403) {
        const err = new Error("Cloudflare bloqueó createUser");
        err.code = "CF_BLOCKED";
        err.needRenewCfClearance = true;
        throw err;
      } else if (result.status === 422) {
        // Error de validación - mostrar detalles
        const errorMsg = result.data?.message || 'Validation error';
        const errors = result.data?.errors || {};
        this._log("CREATE_VALIDATION_ERR", `Errores de validación: ${JSON.stringify(errors)}`);
        throw new Error(`Validation error (422): ${errorMsg}`);
      } else {
        throw new Error(`Create user failed with status ${result.status}: ${result.text}`);
      }
    } catch (e) {
      this._log("CREATE_ERR", `Error creando usuario: ${e.message}`);
      throw e;
    }
  }

  async create({ name, suffix, fixedPassword }) {
    const starwin = this._getStarwinCfg();

    // ✅ Verificar que tengamos Puppeteer disponible
    if (!this.puppeteerPage) {
      this._log("NO_PUPPETEER", "⚠️ No hay sesión de Puppeteer. Renovar Cloudflare primero.");
      return { 
        ok: false, 
        error: "No hay sesión activa. Renovar Cloudflare primero.",
        needRenewCfClearance: true
      };
    }

    try {
      // 1) CSRF
      const csrfToken = await this._getCsrfCookie(starwin);

      // 2) Login
      const adminUser = starwin.adminUser;
      const adminPass = starwin.adminPass;
      if (!adminUser || !adminPass) {
        this._log("AUTH_ERR", "Faltan starwin.adminUser / starwin.adminPass");
        return { ok: false, error: "Faltan credenciales admin en config" };
      }

      await this._login(starwin, { username: adminUser, password: adminPass }, csrfToken);

      // 3) Create user
      const result = await this._createUser(starwin, { name, suffix, fixedPassword }, csrfToken);

      return { ok: true, username: result.username, password: result.password, result };
    } catch (error) {
      const needRenew = Boolean(error?.needRenewCfClearance || error?.code === "CF_BLOCKED");

      this._log(
        "CREATE_ERR",
        `Error: ${error?.message || error}`,
        { needRenewCfClearance: needRenew }
      );

      return {
        ok: false,
        error: error.message || "Error desconocido",
        code: error?.code,
        needRenewCfClearance: needRenew
      };
    }
  }

  // ✅ NUEVO: Método para establecer la página de Puppeteer
  setPuppeteerPage(page) {
    this.puppeteerPage = page;
    this._log("PUPPETEER_SET", "✅ Página de Puppeteer configurada");
  }

  // ✅ NUEVO: Método para limpiar la página
  clearPuppeteerPage() {
    this.puppeteerPage = null;
    this._log("PUPPETEER_CLEARED", "⚠️ Página de Puppeteer eliminada");
  }
}

module.exports = { UserCreator };
