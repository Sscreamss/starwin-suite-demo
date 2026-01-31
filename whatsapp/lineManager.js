// whatsapp/lineManager.js
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

class LineManager {
    constructor({ basePath, onQr, onStatus, onMessage, onLog }) {
        this.basePath = basePath;
        this.onQr = onQr;
        this.onStatus = onStatus;
        this.onMessage = onMessage;
        this.onLog = onLog;
        this.engine = null;
        this.clients = new Map();
        this.statuses = new Map();
        
        this._log('INIT', 'LineManager inicializado');
    }
    
    _log(type, message, lineId = null) {
        this.onLog?.({ 
            at: new Date().toISOString(), 
            type: `LINE_${type}`, 
            message,
            lineId 
        });
        console.log(`[LineManager${lineId ? `:${lineId}` : ''}] ${message}`);
    }
    
    setEngine(engine) {
        this.engine = engine;
        this._log('ENGINE_SET', 'Motor de bot configurado');
    }
    
    async listLines() {
        try {
            const linesDir = path.join(this.basePath, 'lines');
            if (!fs.existsSync(linesDir)) {
                fs.mkdirSync(linesDir, { recursive: true });
                return Array.from({ length: 30 }, (_, i) => ({
                    lineId: `line${String(i + 1).padStart(3, '0')}`,
                    name: `Línea ${i + 1}`,
                    createdAt: new Date().toISOString()
                }));
            }
            
            const lines = Array.from({ length: 30 }, (_, i) => ({
                lineId: `line${String(i + 1).padStart(3, '0')}`,
                name: `Línea ${i + 1}`,
                createdAt: new Date().toISOString()
            }));
            
            return lines;
        } catch (error) {
            this._log('LIST_ERROR', `Error listando líneas: ${error.message}`);
            return [];
        }
    }
    
    async startLine(lineId) {
        try {
            if (this.clients.has(lineId)) {
                this._log('START_ERROR', `Línea ${lineId} ya está activa`, lineId);
                return { ok: false, error: 'Línea ya activa' };
            }
            
            this._log('START', `Iniciando línea ${lineId}`, lineId);
            this.statuses.set(lineId, { state: 'STARTING' });
            this.onStatus?.(lineId, { state: 'STARTING' });
            
            const sessionDir = path.join(this.basePath, 'sessions', lineId);
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
            
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: lineId,
                    dataPath: sessionDir
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--log-level=3'
                    ]
                },
                qrTimeout: 0,
                takeoverOnConflict: false,
                webVersionCache: {
                    type: 'remote',
                    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
                }
            });
            
            client.on('qr', (qr) => {
                this._log('QR_RECEIVED', 'Código QR recibido', lineId);
                
                // Generar QR en terminal
                console.log(`\n=== QR CODE PARA ${lineId} ===`);
                qrcode.generate(qr, { small: true });
                console.log(`=== FIN QR CODE ===\n`);
                
                // Convertir QR a URL base64 para la UI
                const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qr)}`;
                
                this.statuses.set(lineId, { 
                    state: 'QR', 
                    qr: qr,
                    qrImage: qrImageUrl 
                });
                
                this.onStatus?.(lineId, { 
                    state: 'QR',
                    qr: qrImageUrl
                });
                
                this.onQr?.(lineId, qrImageUrl);
            });
            
            client.on('ready', () => {
                this._log('READY', 'Cliente listo', lineId);
                
                const info = client.info;
                const wid = info.wid?.user || info.me?.user || lineId;
                const pushname = info.pushname || info.me?.name || 'Usuario';
                
                this.statuses.set(lineId, { 
                    state: 'READY', 
                    wid: `${wid}@c.us`,
                    pushname,
                    info: client.info 
                });
                
                this.onStatus?.(lineId, { 
                    state: 'READY', 
                    wid: `${wid}@c.us`,
                    pushname 
                });
            });
            
            client.on('authenticated', () => {
                this._log('AUTHENTICATED', 'Autenticado', lineId);
                this.statuses.set(lineId, { state: 'AUTHENTICATED' });
                this.onStatus?.(lineId, { state: 'AUTHENTICATED' });
            });
            
            client.on('message', async (msg) => {
                if (msg.from === 'status@broadcast') return;
                
                try {
                    const from = msg.from;
                    const body = msg.body || '';
                    const timestamp = new Date().toISOString();
                    
                    this._log('MESSAGE_RECEIVED', `Mensaje de ${from}: ${body.substring(0, 50)}`, lineId);
                    this.onMessage?.(lineId, { 
                        from, 
                        body, 
                        timestamp,
                        type: msg.type,
                        hasMedia: msg.hasMedia 
                    });
                    
                    if (this.engine && body.trim()) {
                        await this.engine.handleIncoming({
                            lineId,
                            from,
                            text: body,
                            ts: timestamp
                        });
                    }
                } catch (error) {
                    this._log('MESSAGE_ERROR', `Error procesando mensaje: ${error.message}`, lineId);
                }
            });
            
            client.on('disconnected', (reason) => {
                this._log('DISCONNECTED', `Desconectado: ${reason}`, lineId);
                this.statuses.set(lineId, { 
                    state: 'DISCONNECTED', 
                    reason: reason || 'UNKNOWN' 
                });
                this.onStatus?.(lineId, { 
                    state: 'DISCONNECTED', 
                    reason: reason || 'UNKNOWN' 
                });
                this.clients.delete(lineId);
            });
            
            client.on('auth_failure', (error) => {
                this._log('AUTH_FAILURE', `Error de autenticación: ${error}`, lineId);
                this.statuses.set(lineId, { 
                    state: 'AUTH_FAILURE', 
                    error: String(error) 
                });
                this.onStatus?.(lineId, { 
                    state: 'AUTH_FAILURE', 
                    error: String(error) 
                });
            });
            
            await client.initialize();
            this.clients.set(lineId, client);
            
            return { ok: true, message: `Línea ${lineId} iniciada` };
        } catch (error) {
            this._log('START_ERROR', `Error iniciando línea: ${error.message}`, lineId);
            this.statuses.set(lineId, { 
                state: 'ERROR', 
                error: error.message 
            });
            this.onStatus?.(lineId, { 
                state: 'ERROR', 
                error: error.message 
            });
            return { ok: false, error: error.message };
        }
    }
    
    async stopLine(lineId) {
        try {
            const client = this.clients.get(lineId);
            if (!client) {
                this._log('STOP_ERROR', `Línea ${lineId} no encontrada`, lineId);
                return { ok: false, error: 'Línea no encontrada' };
            }
            
            this._log('STOP', `Deteniendo línea ${lineId}`, lineId);
            this.statuses.set(lineId, { state: 'STOPPING' });
            this.onStatus?.(lineId, { state: 'STOPPING' });
            
            await client.destroy();
            this.clients.delete(lineId);
            this.statuses.set(lineId, { state: 'STOPPED' });
            this.onStatus?.(lineId, { state: 'STOPPED' });
            
            this._log('STOP_SUCCESS', `Línea ${lineId} detenida`, lineId);
            return { ok: true, message: `Línea ${lineId} detenida` };
        } catch (error) {
            this._log('STOP_ERROR', `Error deteniendo línea: ${error.message}`, lineId);
            return { ok: false, error: error.message };
        }
    }
    
    async getStatus(lineId) {
        const status = this.statuses.get(lineId) || { state: 'STOPPED' };
        return { lineId, ...status };
    }
    
    async sendMessage(lineId, to, text) {
        try {
            const client = this.clients.get(lineId);
            if (!client) {
                this._log('SEND_ERROR', `Línea ${lineId} no activa`, lineId);
                return { ok: false, error: 'Línea no activa' };
            }
            
            const status = this.statuses.get(lineId);
            if (status?.state !== 'READY') {
                this._log('SEND_ERROR', `Cliente no está listo (estado: ${status?.state})`, lineId);
                return { ok: false, error: 'Cliente no listo' };
            }
            
            this._log('SEND', `Enviando mensaje a ${to}`, lineId);
            await client.sendMessage(to, text);
            
            this._log('SEND_SUCCESS', `Mensaje enviado a ${to}`, lineId);
            return { ok: true, used: to };
        } catch (error) {
            this._log('SEND_ERROR', `Error enviando mensaje: ${error.message}`, lineId);
            return { ok: false, error: error.message };
        }
    }
    
    async broadcastMessage(toNumbers, text) {
        const results = [];
        
        for (const [lineId, client] of this.clients.entries()) {
            const status = this.statuses.get(lineId);
            if (status?.state === 'READY') {
                for (const to of toNumbers) {
                    try {
                        await client.sendMessage(to, text);
                        results.push({ lineId, to, success: true });
                    } catch (error) {
                        results.push({ lineId, to, success: false, error: error.message });
                    }
                }
            }
        }
        
        return results;
    }
    
    async getAllStatuses() {
        const statuses = [];
        for (const [lineId, status] of this.statuses) {
            statuses.push({ lineId, ...status });
        }
        return statuses;
    }
    
    async stopAll() {
        const results = [];
        for (const [lineId, client] of this.clients) {
            try {
                await client.destroy();
                results.push({ lineId, success: true });
                this._log('STOP_ALL', `Línea ${lineId} detenida`, lineId);
            } catch (error) {
                results.push({ lineId, success: false, error: error.message });
                this._log('STOP_ALL_ERROR', `Error deteniendo ${lineId}: ${error.message}`, lineId);
            }
        }
        this.clients.clear();
        this.statuses.clear();
        return results;
    }
    
    getActiveLines() {
        return Array.from(this.clients.keys());
    }
    
    getLineCount() {
        return this.clients.size;
    }
    
    async restartLine(lineId) {
        await this.stopLine(lineId);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await this.startLine(lineId);
    }
}

module.exports = { LineManager };