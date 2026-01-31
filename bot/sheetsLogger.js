// bot/sheetsLogger.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

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

  _initialize() {
    try {
      // Leer credenciales
      const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
      
      // Leer configuración
      this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      
      // Crear cliente de autenticación
      this.auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      
      // Crear cliente de Sheets API
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      this._log('INIT', '✅ SheetsLogger inicializado correctamente');
    } catch (error) {
      this._log('INIT_ERROR', `❌ Error inicializando: ${error.message}`);
    }
  }

  /**
   * Guarda un usuario en Google Sheets
   * @param {Object} userData - Datos del usuario
   * @param {string} userData.nombre - Nombre del usuario
   * @param {string} userData.telefono - Teléfono (WhatsApp ID)
   * @param {string} userData.usuario - Username creado
   * @param {string} userData.password - Contraseña
   * @param {string} userData.linea - ID de la línea de WhatsApp
   * @param {boolean} userData.deposito - Si depositó o no
   */
  async logUser(userData) {
    if (!this.sheets || !this.config) {
      this._log('LOG_ERROR', '❌ Sheets no inicializado');
      return { ok: false, error: 'Sheets no inicializado' };
    }

    try {
      const { nombre, telefono, usuario, password, linea, deposito } = userData;
      
      // Fecha y hora actual en formato legible
      const fecha = new Date().toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      // Construir fila según el orden de columnas del config
      const row = [
        nombre || '',              // Nombre
        telefono || '',            // Teléfono
        usuario || '',             // Usuario
        password || '',            // Contraseña
        fecha,                     // Fecha Creación
        linea || '',               // Linea WPP
        deposito ? 'SÍ' : 'NO'     // Depositó
      ];

      this._log('LOG_ATTEMPT', `📝 Guardando usuario: ${usuario}`);

      // Agregar fila a Google Sheets
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A2`, // Empieza en A2 (A1 son los headers)
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row]
        }
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
   * Actualiza el estado de depósito de un usuario
   * @param {string} telefono - Teléfono del usuario
   * @param {boolean} deposito - Nuevo estado de depósito
   */
  async updateDeposit(telefono, deposito) {
    if (!this.sheets || !this.config) {
      this._log('UPDATE_ERROR', '❌ Sheets no inicializado');
      return { ok: false, error: 'Sheets no inicializado' };
    }

    try {
      // Buscar el usuario por teléfono
      const searchResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!B:B` // Columna de Teléfono
      });

      const rows = searchResponse.data.values || [];
      const rowIndex = rows.findIndex(row => row[0] === telefono);

      if (rowIndex === -1) {
        this._log('UPDATE_ERROR', `❌ Usuario no encontrado: ${telefono}`);
        return { ok: false, error: 'Usuario no encontrado' };
      }

      // Actualizar columna G (Depositó) - rowIndex + 1 porque las filas empiezan en 1
      const updateResponse = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!G${rowIndex + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[deposito ? 'SÍ' : 'NO']]
        }
      });

      this._log('UPDATE_SUCCESS', `✅ Estado de depósito actualizado: ${telefono}`);
      return { ok: true, data: updateResponse.data };
    } catch (error) {
      this._log('UPDATE_ERROR', `❌ Error actualizando depósito: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Obtiene todos los usuarios de la planilla
   * @returns {Array} Array de objetos con datos de usuarios
   */
  async getAllUsers() {
    if (!this.sheets || !this.config) {
      this._log('GET_ERROR', '❌ Sheets no inicializado');
      return { ok: false, error: 'Sheets no inicializado', users: [] };
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A2:G` // A partir de fila 2 (headers en fila 1)
      });

      const rows = response.data.values || [];
      
      const users = rows.map(row => ({
        nombre: row[0] || '',
        telefono: row[1] || '',
        usuario: row[2] || '',
        password: row[3] || '',
        fecha: row[4] || '',
        linea: row[5] || '',
        deposito: row[6] === 'SÍ'
      }));

      this._log('GET_SUCCESS', `✅ Obtenidos ${users.length} usuarios de Sheets`);
      return { ok: true, users };
    } catch (error) {
      this._log('GET_ERROR', `❌ Error obteniendo usuarios: ${error.message}`);
      return { ok: false, error: error.message, users: [] };
    }
  }

  /**
   * Obtiene estadísticas de usuarios
   * @returns {Object} Estadísticas
   */
  async getStats() {
    const result = await this.getAllUsers();
    if (!result.ok) {
      return { ok: false, stats: null };
    }

    const users = result.users;
    const now = new Date();
    const today = now.toLocaleDateString('es-AR');

    // Usuarios de hoy
    const usersToday = users.filter(u => {
      if (!u.fecha) return false;
      const userDate = new Date(u.fecha.split(' ')[0].split('/').reverse().join('-'));
      return userDate.toLocaleDateString('es-AR') === today;
    }).length;

    // Usuarios de esta semana
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const usersThisWeek = users.filter(u => {
      if (!u.fecha) return false;
      const userDate = new Date(u.fecha.split(' ')[0].split('/').reverse().join('-'));
      return userDate >= weekAgo;
    }).length;

    // Usuarios que depositaron
    const usersDeposited = users.filter(u => u.deposito).length;

    // Usuarios por línea
    const usersByLine = users.reduce((acc, u) => {
      acc[u.linea] = (acc[u.linea] || 0) + 1;
      return acc;
    }, {});

    const stats = {
      total: users.length,
      today: usersToday,
      thisWeek: usersThisWeek,
      deposited: usersDeposited,
      depositRate: users.length > 0 ? ((usersDeposited / users.length) * 100).toFixed(1) : 0,
      byLine: usersByLine
    };

    this._log('STATS', `📊 Stats: Total=${stats.total}, Hoy=${stats.today}, Semana=${stats.thisWeek}`);
    return { ok: true, stats };
  }

  /**
   * Obtiene usuarios agrupados por día para gráficos
   * @param {number} days - Número de días hacia atrás
   * @returns {Object} Datos para gráficos
   */
  async getUsersByDay(days = 30) {
    const result = await this.getAllUsers();
    if (!result.ok) {
      return { ok: false, data: [] };
    }

    const users = result.users;
    const now = new Date();
    const dayMap = {};

    // Inicializar últimos N días
    for (let i = 0; i < days; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toLocaleDateString('es-AR');
      dayMap[dateStr] = 0;
    }

    // Contar usuarios por día
    users.forEach(u => {
      if (!u.fecha) return;
      const datePart = u.fecha.split(' ')[0]; // "31/01/2026 14:30:00" -> "31/01/2026"
      if (dayMap[datePart] !== undefined) {
        dayMap[datePart]++;
      }
    });

    // Convertir a array ordenado
    const data = Object.entries(dayMap)
      .map(([date, count]) => ({ date, count }))
      .reverse(); // Más reciente primero

    return { ok: true, data };
  }
}

module.exports = { SheetsLogger };
