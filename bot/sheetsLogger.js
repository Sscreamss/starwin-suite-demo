// bot/sheetsLogger.js
const { google } = require('googleapis');
const fs = require('fs');

class SheetsLogger {
  constructor({ credentialsPath, configPath, onLog }) {
    this.credentialsPath = credentialsPath;
    this.configPath = configPath;
    this.onLog = onLog;
    this.auth = null;
    this.sheets = null;
    this.config = null;

    this._initialize();
  }

  _log(type, message, extra = {}) {
    this.onLog?.({
      at: new Date().toISOString(),
      type: `SHEETS_${type}`,
      message,
      ...extra
    });
    console.log(`[SheetsLogger] ${message}`);
  }

  // ✅ Helper: limpiar teléfono (quitar @c.us, @lid, @s.whatsapp.net)
  _cleanPhone(raw) {
    return String(raw || '').trim().replace(/@.+$/, '');
  }

  _initialize() {
    try {
      const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
      this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));

      this.auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      this._log('INIT', '✅ SheetsLogger inicializado correctamente');
    } catch (error) {
      this._log('INIT_ERROR', `❌ Error inicializando: ${error.message}`);
    }
  }

  async logUser(userData) {
    if (!this.sheets || !this.config) {
      this._log('LOG_ERROR', '❌ Sheets no inicializado');
      return { ok: false, error: 'Sheets no inicializado' };
    }

    try {
      const { nombre, telefono, usuario, password, linea, deposito } = userData;

      const fecha = new Date().toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      // ✅ Guardar teléfono limpio (sin @c.us ni @lid)
      const telefonoClean = this._cleanPhone(telefono);

      const row = [
        nombre || '',
        telefonoClean,
        usuario || '',
        password || '',
        fecha,
        linea || '',
        deposito ? 'SÍ' : 'NO'
      ];

      this._log('LOG_ATTEMPT', `📝 Guardando usuario: ${usuario} (tel: ${telefonoClean})`);

      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A2`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] }
      });

      this._log('LOG_SUCCESS', `✅ Usuario guardado en Sheets: ${usuario}`, {
        range: response.data.updates.updatedRange,
        rows: response.data.updates.updatedRows
      });

      return { ok: true, data: response.data };
    } catch (error) {
      this._log('LOG_ERROR', `❌ Error guardando usuario: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return { ok: false, error: error.message };
    }
  }

  /**
   * Actualiza depósito buscando por teléfono.
   * ✅ FIX: Compara números limpios para encontrar tanto los viejos (@c.us) como los nuevos.
   */
  async updateDeposit(telefono, deposito) {
    if (!this.sheets || !this.config) {
      this._log('UPDATE_ERROR', '❌ Sheets no inicializado');
      return { ok: false, error: 'Sheets no inicializado' };
    }

    try {
      const telefonoNorm = this._cleanPhone(telefono);
      if (!telefonoNorm) {
        this._log('UPDATE_ERROR', '❌ Teléfono vacío/undefined en updateDeposit');
        return { ok: false, error: 'Teléfono inválido' };
      }

      // Traer todas las filas (sin headers)
      const startRow = 2;
      const getResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A${startRow}:G`
      });

      const rows = getResponse.data.values || [];

      // ✅ FIX: Comparar números limpios (sin @c.us/@lid) para matchear filas viejas y nuevas
      let lastMatchIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        const rowTelefono = this._cleanPhone((rows[i] && rows[i][1]) || '');
        if (rowTelefono === telefonoNorm) {
          lastMatchIndex = i;
        }
      }

      if (lastMatchIndex === -1) {
        this._log('UPDATE_ERROR', `❌ Usuario no encontrado por teléfono: ${telefonoNorm}`);
        return { ok: false, error: 'Usuario no encontrado' };
      }

      const targetRowNumber = startRow + lastMatchIndex;
      const value = deposito ? 'SÍ' : 'NO';

      const updateResponse = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!G${targetRowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] }
      });

      this._log('UPDATE_SUCCESS', `✅ Depósito actualizado: ${telefonoNorm} -> ${value}`, {
        row: targetRowNumber
      });

      return { ok: true, data: updateResponse.data };
    } catch (error) {
      this._log('UPDATE_ERROR', `❌ Error actualizando depósito: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return { ok: false, error: error.message };
    }
  }

  async getAllUsers() {
    if (!this.sheets || !this.config) {
      this._log('GET_ERROR', '❌ Sheets no inicializado');
      return { ok: false, error: 'Sheets no inicializado', users: [] };
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A2:G`
      });

      const rows = response.data.values || [];

      const users = rows.map(row => ({
        nombre: row[0] || '',
        telefono: row[1] || '',
        usuario: row[2] || '',
        password: row[3] || '',
        fecha: row[4] || '',
        linea: row[5] || '',
        deposito: String(row[6] || '').trim() === 'SÍ'
      }));

      this._log('GET_SUCCESS', `✅ Obtenidos ${users.length} usuarios de Sheets`);
      return { ok: true, users };
    } catch (error) {
      this._log('GET_ERROR', `❌ Error obteniendo usuarios: ${error.message}`);
      return { ok: false, error: error.message, users: [] };
    }
  }

  // ✅ Helper: parsear fecha DD/MM/YYYY desde el sheet de forma robusta
  _parseDate(fechaStr) {
    if (!fechaStr) return null;
    const datePart = fechaStr.split(',')[0].trim(); // "24/02/2026" de "24/02/2026, 00:01:54"
    const parts = datePart.split('/');
    if (parts.length !== 3) return null;
    const [day, month, year] = parts.map(Number);
    if (!day || !month || !year) return null;
    return new Date(year, month - 1, day); // Local timezone, no UTC issues
  }

  // ✅ Helper: obtener fecha como DD/MM/YYYY con ceros (para matchear con el sheet)
  _formatDateKey(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  async getStats() {
    const result = await this.getAllUsers();
    if (!result.ok) return { ok: false, stats: null };

    const users = result.users;
    const now = new Date();
    const todayKey = this._formatDateKey(now);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const usersToday = users.filter(u => {
      if (!u.fecha) return false;
      const datePart = u.fecha.split(',')[0].trim();
      return datePart === todayKey;
    }).length;

    const usersThisWeek = users.filter(u => {
      const parsed = this._parseDate(u.fecha);
      if (!parsed) return false;
      return parsed >= weekAgo;
    }).length;

    const usersDeposited = users.filter(u => u.deposito).length;

    // ✅ NUEVO: Depósitos de hoy y esta semana
    const depositedToday = users.filter(u => {
      if (!u.deposito || !u.fecha) return false;
      const datePart = u.fecha.split(',')[0].trim();
      return datePart === todayKey;
    }).length;

    const depositedThisWeek = users.filter(u => {
      if (!u.deposito) return false;
      const parsed = this._parseDate(u.fecha);
      if (!parsed) return false;
      return parsed >= weekAgo;
    }).length;

    const usersByLine = users.reduce((acc, u) => {
      acc[u.linea] = (acc[u.linea] || 0) + 1;
      return acc;
    }, {});

    const stats = {
      total: users.length,
      today: usersToday,
      thisWeek: usersThisWeek,
      deposited: usersDeposited,
      depositedToday,
      depositedThisWeek,
      depositRate: users.length > 0 ? ((usersDeposited / users.length) * 100).toFixed(1) : 0,
      byLine: usersByLine
    };

    this._log('STATS', `📊 Stats: Total=${stats.total}, Hoy=${stats.today}, Semana=${stats.thisWeek}, DepHoy=${depositedToday}, DepSemana=${depositedThisWeek}`);
    return { ok: true, stats };
  }

  async getUsersByDay(days = 30) {
    const result = await this.getAllUsers();
    if (!result.ok) return { ok: false, data: [] };

    const users = result.users;
    const now = new Date();
    const dayMap = {};

    for (let i = 0; i < days; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = this._formatDateKey(date);
      dayMap[key] = 0;
    }

    users.forEach(u => {
      if (!u.fecha) return;
      const datePart = u.fecha.split(',')[0].trim();
      if (dayMap[datePart] !== undefined) dayMap[datePart]++;
    });

    const data = Object.entries(dayMap)
      .map(([date, count]) => ({ date, count }))
      .reverse();

    return { ok: true, data };
  }
}

module.exports = { SheetsLogger };