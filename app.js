// renderer/app.js
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
    lines: [],
    statuses: {},
    consoles: {
        global: [],
        line001: [], line002: [], line003: [], line004: [], line005: [],
        line006: [], line007: [], line008: [], line009: [], line010: [],
        line011: [], line012: [], line013: [], line014: [], line015: [],
        line016: [], line017: [], line018: [], line019: [], line020: [],
        line021: [], line022: [], line023: [], line024: [], line025: [],
        line026: [], line027: [], line028: [], line029: [], line030: []
    },
    activeConsole: 'global',
    cfStatus: null,
    qrModal: null,
    // ✅ NUEVO: Estado del timer de auto-renew
    cfTimer: {
        intervalMinutes: 15,
        secondsRemaining: 0,
        tickInterval: null,
        isRenewing: false
    }
};

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function pushLog(lineId, line, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${line}`;
    
    // Guardar en consola global
    state.consoles.global.unshift(`<span class="${type}">${escapeHtml(logEntry)}</span>`);
    state.consoles.global = state.consoles.global.slice(0, 500);
    
    // Guardar en consola específica de la línea
    if (lineId && state.consoles[lineId]) {
        state.consoles[lineId].unshift(`<span class="${type}">${escapeHtml(logEntry)}</span>`);
        state.consoles[lineId] = state.consoles[lineId].slice(0, 300);
    }
    
    renderConsole(state.activeConsole);
}

function renderConsole(consoleId) {
    const el = $(`#console-${consoleId}`);
    if (!el) return;
    
    const logs = state.consoles[consoleId] || [];
    el.innerHTML = logs.map(l => `<div class="log-line">${l}</div>`).join('');
}

function renderAllConsoles() {
    Object.keys(state.consoles).forEach(id => {
        renderConsole(id);
    });
}

function switchConsole(consoleId) {
    $$('.console').forEach(el => el.classList.remove('active'));
    $$('.tab').forEach(el => el.classList.remove('active'));
    
    $(`#console-${consoleId}`)?.classList.add('active');
    $(`#tab-${consoleId}`)?.classList.add('active');
    
    state.activeConsole = consoleId;
}

function createConsoleTabs() {
    const container = $('#consoleTabs');
    if (!container) return;
    
    const tabs = [
        { id: 'global', name: 'Global', icon: 'fas fa-globe' },
        ...state.lines.map(line => ({
            id: line.lineId,
            name: line.lineId,
            icon: getLineIcon(line.lineId)
        }))
    ];
    
    container.innerHTML = tabs.map(tab => `
        <button class="tab" id="tab-${tab.id}" data-console="${tab.id}">
            <i class="${tab.icon}"></i> ${tab.name}
        </button>
    `).join('');
    
    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchConsole(tab.dataset.console);
        });
    });
}

function getLineIcon(lineId) {
    const status = state.statuses[lineId]?.state || 'STOPPED';
    switch(status) {
        case 'READY': return 'fas fa-check-circle';
        case 'QR': return 'fas fa-qrcode';
        case 'AUTHENTICATED': return 'fas fa-user-check';
        case 'STARTING': return 'fas fa-play-circle';
        case 'STOPPED': return 'fas fa-stop-circle';
        case 'DISCONNECTED': return 'fas fa-plug';
        default: return 'fas fa-circle';
    }
}

async function refreshLines() {
    try {
        const lines = await window.api.linesList();
        state.lines = lines;
        renderLines();
        createConsoleTabs();
        updateStats();
    } catch (error) {
        pushLog(null, `[ERROR] Error refrescando líneas: ${error.message}`, 'error');
    }
}

function renderLines() {
    const container = $('#lines');
    if (!container) return;
    
    container.innerHTML = '';
    
    for (const line of state.lines) {
        const st = state.statuses[line.lineId] || { state: "STOPPED" };
        const status = st.state || "STOPPED";
        
        const row = document.createElement('div');
        row.className = 'line-row';
        row.dataset.lineId = line.lineId;
        
        row.innerHTML = `
            <div class="line-header">
                <div class="line-id">
                    <i class="fas fa-mobile-alt"></i>
                    ${line.lineId}
                </div>
                <div class="line-status status-${status}">${status}</div>
            </div>
            <div class="line-info">
                ${st.pushname ? `
                    <div class="line-pushname">
                        <i class="fas fa-user"></i>
                        ${st.pushname}
                    </div>
                ` : ''}
                ${st.wid ? `
                    <div class="line-wid">
                        <i class="fas fa-id-card"></i>
                        ${st.wid.substring(0, 20)}...
                    </div>
                ` : ''}
            </div>
            <div class="line-actions">
                <button class="btn btn-sm ${status === 'READY' || status === 'AUTHENTICATED' ? 'btn-danger' : 'btn-success'}" 
                        data-action="${status === 'READY' || status === 'AUTHENTICATED' ? 'stop' : 'start'}" 
                        data-line="${line.lineId}">
                    <i class="fas fa-${status === 'READY' || status === 'AUTHENTICATED' ? 'stop' : 'play'}"></i>
                    ${status === 'READY' || status === 'AUTHENTICATED' ? 'Stop' : 'Start'}
                </button>
                <button class="btn btn-sm btn-secondary btn-console" data-line="${line.lineId}">
                    <i class="fas fa-terminal"></i> Consola
                </button>
                ${status === 'QR' ? `
                    <button class="btn btn-sm btn-warning btn-qr" data-line="${line.lineId}">
                        <i class="fas fa-qrcode"></i> QR
                    </button>
                ` : ''}
            </div>
        `;
        
        container.appendChild(row);
    }
}

// Event delegation separado (se bindea una sola vez en init)
function setupLinesClickHandler() {
    const container = $('#lines');
    if (!container) return;
    
    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) {
            // Click en la línea completa → abrir consola
            const row = e.target.closest('.line-row');
            if (row) switchConsole(row.dataset.lineId);
            return;
        }
        
        const lineId = btn.dataset.line;
        if (!lineId) return;
        
        if (btn.dataset.action) {
            await handleLineAction(lineId, btn.dataset.action);
        } else if (btn.classList.contains('btn-console')) {
            switchConsole(lineId);
        } else if (btn.classList.contains('btn-qr')) {
            showQR(lineId);
        }
    });
}

async function handleLineAction(lineId, action) {
    const btn = document.querySelector(`button[data-line="${lineId}"][data-action]`);
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${action === 'start' ? 'Iniciando...' : 'Deteniendo...'}`;
    
    try {
        if (action === 'start') {
            await window.api.linesStart(lineId);
            pushLog(lineId, `[UI] Iniciando línea ${lineId}`, 'info');
        } else {
            await window.api.linesStop(lineId);
            pushLog(lineId, `[UI] Deteniendo línea ${lineId}`, 'info');
        }
    } catch (error) {
        pushLog(lineId, `[ERROR] Error en línea ${lineId}: ${error.message}`, 'error');
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            refreshLines();
        }, 1000);
    }
}

async function refreshCfStatus() {
    try {
        const status = await window.api.cfStatus();
        state.cfStatus = status;
        renderCfStatus();
    } catch (error) {
        pushLog(null, `[ERROR] Error obteniendo estado CF: ${error.message}`, 'error');
    }
}

function renderCfStatus() {
    const container = $('#cfStatus');
    if (!container || !state.cfStatus) return;
    
    const status = state.cfStatus;
    const hasCookie = status.hasCookie;
    const needsRenewal = status.needsRenewal;
    
    let statusText = "";
    let statusClass = "";
    let icon = "fas fa-shield-alt";
    
    if (!hasCookie) {
        statusText = "Sin cookie CF";
        statusClass = "status-error";
        icon = "fas fa-times-circle";
    } else if (needsRenewal) {
        statusText = "Necesita renovación";
        statusClass = "status-warning";
        icon = "fas fa-exclamation-triangle";
    } else {
        statusText = "CF Activo";
        statusClass = "status-ok";
        icon = "fas fa-check-circle";
    }
    
    container.className = `cf-status ${statusClass}`;
    container.innerHTML = `
        <div class="cf-icon"><i class="${icon}"></i></div>
        <div class="cf-text">
            <div class="cf-title">Cloudflare</div>
            <div class="cf-desc">${statusText}</div>
        </div>
    `;
}

function updateStats() {
    const activeLines = state.lines.filter(line => {
        const status = state.statuses[line.lineId]?.state;
        return status === 'READY' || status === 'AUTHENTICATED';
    }).length;
    
    $('#linesCount').textContent = `${state.lines.length}/30`;
    $('#activeLines').textContent = activeLines;
}

function showQR(lineId) {
    const qrData = state.statuses[lineId]?.qr;
    if (!qrData) {
        pushLog(lineId, '[ERROR] No hay código QR disponible', 'error');
        return;
    }
    
    $('#qrLineId').textContent = lineId;
    $('#qrImage').src = qrData;
    $('#qrModal').classList.add('active');
}

// ============================================
// ✅ NUEVO: Timer de Auto-Renew CF
// ============================================

function formatCountdown(totalSeconds) {
    if (totalSeconds <= 0) return "00:00";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startCfCountdown(intervalMinutes) {
    // Limpiar intervalo anterior
    if (state.cfTimer.tickInterval) {
        clearInterval(state.cfTimer.tickInterval);
    }

    state.cfTimer.intervalMinutes = intervalMinutes;
    state.cfTimer.secondsRemaining = intervalMinutes * 60;
    state.cfTimer.isRenewing = false;

    const countdownEl = $('#cfCountdown');
    const statusEl = $('#cfTimerStatus');
    const timerContainer = $('#cfAutoRenewTimer');

    if (!countdownEl || !statusEl) return;

    // Actualizar UI cada segundo
    state.cfTimer.tickInterval = setInterval(() => {
        if (state.cfTimer.isRenewing) return; // No decrementar mientras renueva

        state.cfTimer.secondsRemaining--;

        if (state.cfTimer.secondsRemaining <= 0) {
            state.cfTimer.secondsRemaining = 0;
        }

        countdownEl.textContent = formatCountdown(state.cfTimer.secondsRemaining);

        // Cambiar color según tiempo restante
        if (state.cfTimer.secondsRemaining <= 60) {
            timerContainer?.classList.add('timer-urgent');
            timerContainer?.classList.remove('timer-warning');
            statusEl.textContent = "Renovando pronto...";
        } else if (state.cfTimer.secondsRemaining <= 180) {
            timerContainer?.classList.add('timer-warning');
            timerContainer?.classList.remove('timer-urgent');
            statusEl.textContent = "Próximamente";
        } else {
            timerContainer?.classList.remove('timer-warning', 'timer-urgent');
            statusEl.textContent = `Cada ${state.cfTimer.intervalMinutes} min`;
        }
    }, 1000);

    // Render inicial
    countdownEl.textContent = formatCountdown(state.cfTimer.secondsRemaining);
    statusEl.textContent = `Cada ${intervalMinutes} min`;
}

function setCfTimerRenewing(isRenewing) {
    state.cfTimer.isRenewing = isRenewing;
    const countdownEl = $('#cfCountdown');
    const statusEl = $('#cfTimerStatus');
    const timerContainer = $('#cfAutoRenewTimer');

    if (isRenewing) {
        if (countdownEl) countdownEl.textContent = "⟳";
        if (statusEl) statusEl.textContent = "Renovando...";
        timerContainer?.classList.add('timer-renewing');
    } else {
        timerContainer?.classList.remove('timer-renewing');
    }
}

async function initCfTimer() {
    try {
        const intervalMinutes = await window.api.cfGetAutoRenewInterval();
        const input = $('#cfIntervalInput');
        if (input) input.value = intervalMinutes;
        startCfCountdown(intervalMinutes);
    } catch (err) {
        // Fallback a 15 minutos
        startCfCountdown(15);
    }
}

// ============================================
// INIT
// ============================================

function init() {
    // Inicializar modal QR
    state.qrModal = $('#qrModal');
    $('#qrModal .btn-close').addEventListener('click', () => {
        state.qrModal.classList.remove('active');
    });
    
    state.qrModal.addEventListener('click', (e) => {
        if (e.target === state.qrModal) {
            state.qrModal.classList.remove('active');
        }
    });
    
    // Inicializar consolas
    Object.keys(state.consoles).forEach(id => {
        const consoleDiv = document.createElement('div');
        consoleDiv.className = 'console';
        consoleDiv.id = `console-${id}`;
        if (id === 'global') consoleDiv.classList.add('active');
        $('.console-container').appendChild(consoleDiv);
    });
    
    // ✅ Bindear event delegation para botones de líneas (una sola vez)
    setupLinesClickHandler();
    
    // Configurar botones de control
    $('#btnRefresh')?.addEventListener('click', () => {
        pushLog(null, '[UI] Refrescando líneas...', 'info');
        refreshLines();
    });
    
    $('#btnOpenConfig')?.addEventListener('click', async () => {
        pushLog(null, '[UI] Abriendo carpeta de configuración...', 'info');
        await window.api.openConfigFolder();
    });
    
    $("#btnEditMessages")?.addEventListener("click", () => {
        pushLog(null, "[UI] Abriendo editor de mensajes...", "info");
        window.location.href = "config.html";
    });

    $('#btnDashboard')?.addEventListener('click', () => {
        pushLog(null, '[UI] Abriendo dashboard...', 'info');
        window.location.href = 'dashboard.html';
    });    
    
    // Buscador de líneas
    $('#searchLines')?.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const rows = $$('.line-row');
        
        rows.forEach(row => {
            const lineId = row.dataset.lineId?.toLowerCase() || '';
            const pushname = row.querySelector('.line-pushname')?.textContent.toLowerCase() || '';
            const wid = row.querySelector('.line-wid')?.textContent.toLowerCase() || '';
            
            const matches = lineId.includes(searchTerm) || 
                          pushname.includes(searchTerm) || 
                          wid.includes(searchTerm);
            
            row.style.display = matches ? '' : 'none';
        });
    });
    
    $('#btnRenewClearance')?.addEventListener('click', async () => {
        pushLog(null, '[UI] Renovando Cloudflare...', 'info');
        const btn = $('#btnRenewClearance');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Renovando...';
        
        try {
            const res = await window.api.starwinRenewClearance();
            if (res?.ok) {
                pushLog(null, '[UI] ✅ Cloudflare actualizado exitosamente', 'success');
            } else {
                pushLog(null, `[UI] ❌ Falló Cloudflare: ${res?.error || "unknown"}`, 'error');
            }
        } catch (error) {
            pushLog(null, `[UI] ❌ Error renovando CF: ${error.message}`, 'error');
        } finally {
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-shield-alt"></i> Renovar CF';
                refreshCfStatus();
            }, 2000);
        }
    });
    
    $('#btnAutoRenew')?.addEventListener('click', async () => {
        pushLog(null, '[UI] Ejecutando renovación automática...', 'info');
        const btn = $('#btnAutoRenew');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
        
        try {
            const res = await window.api.cfAutoRenew();
            if (res?.ok) {
                pushLog(null, `[UI] ✅ Renovación automática: ${res.reason || "Completada"}`, 'success');
            } else {
                pushLog(null, `[UI] ⚠️ Renovación automática: ${res?.error || "No necesaria"}`, 'warning');
            }
        } catch (error) {
            pushLog(null, `[UI] ❌ Error en renovación automática: ${error.message}`, 'error');
        } finally {
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-bolt"></i> Auto Renew';
                refreshCfStatus();
            }, 2000);
        }
    });
    
    $('#btnClearAll')?.addEventListener('click', () => {
        Object.keys(state.consoles).forEach(id => {
            state.consoles[id] = [];
        });
        renderAllConsoles();
        pushLog(null, '[UI] Consolas limpiadas', 'info');
    });
    
    $('#btnStartAll')?.addEventListener('click', async () => {
        pushLog(null, '[UI] Iniciando todas las líneas...', 'info');
        for (const line of state.lines) {
            await handleLineAction(line.lineId, 'start');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    });
    
    $('#btnStopAll')?.addEventListener('click', async () => {
        pushLog(null, '[UI] Deteniendo todas las líneas...', 'info');
        for (const line of state.lines) {
            await handleLineAction(line.lineId, 'stop');
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    });

    // ✅ NUEVO: Botón guardar intervalo de auto-renew
    $('#btnSaveInterval')?.addEventListener('click', async () => {
        const input = $('#cfIntervalInput');
        const minutes = parseInt(input?.value) || 15;
        const btn = $('#btnSaveInterval');
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        try {
            const res = await window.api.cfSetAutoRenewInterval(minutes);
            if (res?.ok) {
                pushLog(null, `[UI] ✅ Intervalo de renovación cambiado a ${res.interval} minutos`, 'success');
                input.value = res.interval;
                // El timer se reinicia automáticamente via el evento cf:timer-reset
            } else {
                pushLog(null, '[UI] ❌ Error cambiando intervalo', 'error');
            }
        } catch (error) {
            pushLog(null, `[UI] ❌ Error: ${error.message}`, 'error');
        } finally {
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i>';
            }, 1000);
        }
    });

    // También guardar con Enter
    $('#cfIntervalInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            $('#btnSaveInterval')?.click();
        }
    });
    
    // Configurar event listeners del backend
    window.api.onLineQr((lineId, qrCode) => {
        state.statuses[lineId] = { ...state.statuses[lineId], state: 'QR', qr: qrCode };
        pushLog(lineId, '[SYSTEM] Código QR generado', 'warning');
        renderLines();
    });
    
    window.api.onLineStatus((lineId, status) => {
        state.statuses[lineId] = { ...state.statuses[lineId], ...status };
        pushLog(lineId, `[STATUS] ${status.state}`, 'info');
        renderLines();
        updateStats();
    });
    
    window.api.onLineMessage((lineId, payload) => {
        pushLog(lineId, `📨 DE ${payload.from}: "${payload.body}"`, 'info');
    });
    
    window.api.onLogEvent((payload) => {
        const type = payload.type || "INFO";
        const message = payload.message || "";
        const lineId = payload.lineId || null;
        let logType = 'info';
        
        if (type.includes('ERROR') || type.includes('FAIL')) logType = 'error';
        else if (type.includes('WARNING')) logType = 'warning';
        else if (type.includes('SUCCESS') || type.includes('OK')) logType = 'success';
        
        pushLog(lineId, `[${type}] ${message}`, logType);
    });

    // ✅ NUEVO: Eventos de auto-renew CF
    window.api.onCfAutoRenewed?.((data) => {
        if (data.ok) {
            pushLog(null, '[AUTO] ✅ CF renovado automáticamente', 'success');
            refreshCfStatus();
        }
    });

    window.api.onCfTimerReset?.((data) => {
        startCfCountdown(data.intervalMinutes);
    });

    window.api.onCfTimerConfig?.((data) => {
        const input = $('#cfIntervalInput');
        if (input) input.value = data.intervalMinutes;
        startCfCountdown(data.intervalMinutes);
    });

    window.api.onCfAutoRenewStatus?.((data) => {
        if (data.status === 'renewing') {
            setCfTimerRenewing(true);
        } else {
            setCfTimerRenewing(false);
        }
    });
    
    // Inicializar tiempo
    function updateTime() {
        const now = new Date();
        $('#currentTime').textContent = now.toLocaleTimeString();
    }
    setInterval(updateTime, 1000);
    updateTime();
    
    // Inicializar aplicación
    refreshLines();
    refreshCfStatus();
    initCfTimer(); // ✅ NUEVO: Inicializar timer
    
    // Auto-refresh cada 30 segundos
    setInterval(() => {
        refreshLines();
        refreshCfStatus();
    }, 30000);
    
    pushLog(null, '[SYSTEM] Dashboard iniciado correctamente', 'success');
}

// Esperar a que cargue el DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}