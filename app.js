// renderer/app.js
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
    lines: [],
    lineNames: {},  // ✅ NUEVO: nombres editables de líneas
    statuses: {},
    consoles: {
        global: []
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

const uiLocks = {
    bulkStartRunning: false,
    bulkStopRunning: false
};

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function ensureLineConsole(lineId) {
    if (!lineId) return;
    if (!state.consoles[lineId]) {
        state.consoles[lineId] = [];
    }

    const container = $('.console-container');
    if (!container) return;

    if (!document.getElementById(`console-${lineId}`)) {
        const consoleDiv = document.createElement('div');
        consoleDiv.className = 'console';
        consoleDiv.id = `console-${lineId}`;
        container.appendChild(consoleDiv);
    }
}

function syncLineConsoles() {
    state.lines.forEach(line => ensureLineConsole(line.lineId));
}

function pushLog(lineId, line, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${line}`;
    
    // Guardar en consola global
    state.consoles.global.unshift(`<span class="${type}">${escapeHtml(logEntry)}</span>`);
    state.consoles.global = state.consoles.global.slice(0, 500);
    
    // Guardar en consola específica de la línea
    if (lineId) {
        ensureLineConsole(lineId);
    }
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
            name: getDisplayName(line.lineId),
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
        const [lines, names] = await Promise.all([
            window.api.linesList(),
            window.api.linesGetNames()
        ]);
        state.lines = lines;
        state.lineNames = names || {};

        // ✅ FIX: Obtener estado real de cada línea del backend
        // (así al volver del dashboard se muestran correctamente)
        const statusPromises = lines.map(line =>
            window.api.linesStatus(line.lineId)
                .then(st => ({ lineId: line.lineId, ...st }))
                .catch(() => ({ lineId: line.lineId, state: "STOPPED" }))
        );
        const statuses = await Promise.all(statusPromises);
        statuses.forEach(st => {
            state.statuses[st.lineId] = { ...state.statuses[st.lineId], ...st };
        });

        syncLineConsoles();
        renderLines();
        createConsoleTabs();
        updateStats();
    } catch (error) {
        pushLog(null, `[ERROR] Error refrescando líneas: ${error.message}`, 'error');
    }
}

function getDisplayName(lineId) {
    return state.lineNames[lineId] || lineId;
}

function renderLines() {
    const container = $('#lines');
    if (!container) return;
    
    container.innerHTML = '';
    
    for (const line of state.lines) {
        const st = state.statuses[line.lineId] || { state: "STOPPED" };
        const status = st.state || "STOPPED";
        const displayName = getDisplayName(line.lineId);
        
        const row = document.createElement('div');
        row.className = 'line-row';
        row.dataset.lineId = line.lineId;
        
        row.innerHTML = `
            <div class="line-header">
                <div class="line-id">
                    <i class="fas fa-mobile-alt"></i>
                    <span class="line-display-name">${escapeHtml(displayName)}</span>
                    <button class="btn-edit-name" data-edit-line="${line.lineId}" title="Editar nombre" style="background:none;border:none;color:#64748b;cursor:pointer;padding:2px 4px;font-size:12px;transition:color .2s;">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
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

// ✅ NUEVO: Edición inline del nombre de línea
function startEditLineName(lineId, editBtn) {
    const row = editBtn.closest('.line-row');
    if (!row) return;
    
    const nameSpan = row.querySelector('.line-display-name');
    if (!nameSpan) return;

    // Si ya hay un input de edición activo, no abrir otro
    if (row.querySelector('.line-name-input')) return;

    const currentName = state.lineNames[lineId] || lineId;
    
    // Reemplazar span por input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'line-name-input';
    input.value = currentName;
    input.maxLength = 30;
    input.style.cssText = 'background:rgba(15,23,42,0.9);border:1px solid #3b82f6;border-radius:4px;color:#fff;font-size:13px;font-weight:600;padding:2px 6px;width:120px;outline:none;';
    
    nameSpan.style.display = 'none';
    editBtn.style.display = 'none';
    nameSpan.parentNode.insertBefore(input, nameSpan);
    input.focus();
    input.select();

    async function saveName() {
        const newName = input.value.trim();
        input.remove();
        nameSpan.style.display = '';
        editBtn.style.display = '';

        if (newName && newName !== lineId) {
            state.lineNames[lineId] = newName;
            nameSpan.textContent = newName;
        } else if (!newName || newName === lineId) {
            delete state.lineNames[lineId];
            nameSpan.textContent = lineId;
        }

        try {
            await window.api.linesSetName(lineId, newName === lineId ? '' : newName);
            createConsoleTabs(); // Actualizar tabs de consola
        } catch (error) {
            pushLog(null, `[ERROR] Error guardando nombre: ${error.message}`, 'error');
        }
    }

    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
}

// Event delegation separado (se bindea una sola vez en init)
function setupLinesClickHandler() {
    const container = $('#lines');
    if (!container) return;
    
    container.addEventListener('click', async (e) => {
        // ✅ NUEVO: Click en el lápiz de edición
        const editBtn = e.target.closest('.btn-edit-name');
        if (editBtn) {
            e.stopPropagation();
            const lineId = editBtn.dataset.editLine;
            startEditLineName(lineId, editBtn);
            return;
        }

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

async function handleLineAction(lineId, action, options = {}) {
    const source = options?.source === 'bulk' ? 'bulk' : 'single';
    if (source === 'single' && (uiLocks.bulkStartRunning || uiLocks.bulkStopRunning)) {
        pushLog(lineId, '[UI] Hay una accion masiva en curso. Espera a que termine.', 'warning');
        return;
    }

    const btn = document.querySelector(`button[data-line="${lineId}"][data-action]`);
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${action === 'start' ? 'Iniciando...' : 'Deteniendo...'}`;
    
    try {
        if (action === 'start') {
            const res = await window.api.linesStart(lineId, { source });
            if (!res?.ok) throw new Error(res?.error || 'No se pudo iniciar la linea');
            pushLog(lineId, `[UI] Iniciando línea ${lineId}`, 'info');
        } else {
            const res = await window.api.linesStop(lineId);
            if (!res?.ok) throw new Error(res?.error || 'No se pudo detener la linea');
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

    const totalLines = state.lines.length;
    $('#linesCount').textContent = `${totalLines}/${totalLines}`;
    const linesHeader = $('.lines-header h3');
    if (linesHeader) {
        linesHeader.innerHTML = `<i class="fas fa-list"></i> Lineas (${totalLines})`;
    }
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
            const displayName = (state.lineNames[row.dataset.lineId] || '').toLowerCase();
            const pushname = row.querySelector('.line-pushname')?.textContent.toLowerCase() || '';
            const wid = row.querySelector('.line-wid')?.textContent.toLowerCase() || '';
            
            const matches = lineId.includes(searchTerm) || 
                          displayName.includes(searchTerm) ||
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
        if (uiLocks.bulkStartRunning || uiLocks.bulkStopRunning) return;
        const confirmed = window.confirm('Esto va a iniciar todas las lineas. Continuar?');
        if (!confirmed) return;

        uiLocks.bulkStartRunning = true;
        try {
            pushLog(null, '[UI] Iniciando todas las lineas...', 'info');
            for (const line of state.lines) {
                await handleLineAction(line.lineId, 'start', { source: 'bulk' });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } finally {
            uiLocks.bulkStartRunning = false;
        }
    });
    
    $('#btnStopAll')?.addEventListener('click', async () => {
        if (uiLocks.bulkStartRunning || uiLocks.bulkStopRunning) return;
        const confirmed = window.confirm('Esto va a detener todas las lineas. Continuar?');
        if (!confirmed) return;

        uiLocks.bulkStopRunning = true;
        try {
            pushLog(null, '[UI] Deteniendo todas las lineas...', 'info');
            for (const line of state.lines) {
                await handleLineAction(line.lineId, 'stop', { source: 'bulk' });
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } finally {
            uiLocks.bulkStopRunning = false;
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
    initCfTimer();
    window.api.appIsPackaged?.()
        .then((isPackaged) => {
            if (isPackaged) {
                initAutoUpdater(); // ✅ NUEVO: Auto-updater
                return;
            }

            // En desarrollo (npm start) no usar updater bloqueante.
            sessionStorage.setItem('updateChecked', '1');
            window.api.appGetVersion?.().then(version => {
                const el = $('#appVersion');
                if (el && version) el.textContent = `v${version}`;
            });
            pushLog(null, '[UPDATE] Modo desarrollo: auto-updater deshabilitado', 'info');
        })
        .catch(() => {
            // Fallback seguro: si no podemos detectar modo, mantener updater normal.
            initAutoUpdater();
        });
    
    // Auto-refresh cada 30 segundos
    setInterval(() => {
        refreshLines();
        refreshCfStatus();
    }, 30000);
    
    pushLog(null, '[SYSTEM] Dashboard iniciado correctamente', 'success');
}

// ============================================
// ✅ NUEVO: Auto-Updater UI
// ============================================

function initAutoUpdater() {
    // Mostrar versión actual en el header
    const versionPromise = window.api.appGetVersion?.() || window.api.updaterGetVersion?.();
    Promise.resolve(versionPromise).then(version => {
        const el = $('#appVersion');
        if (el) el.textContent = `v${version}`;
    });

    // ✅ Solo mostrar overlay bloqueante en el primer arranque real
    // Al volver del dashboard no bloquear (el check ya se hizo)
    const isFirstLoad = !sessionStorage.getItem('updateChecked');

    const overlay = document.createElement('div');
    overlay.id = 'updateOverlay';
    overlay.style.cssText = `display:${isFirstLoad ? 'flex' : 'none'};position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);align-items:center;justify-content:center;`;
    overlay.innerHTML = `
        <div id="updateModal" style="background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid rgba(59,130,246,.4);border-radius:16px;padding:36px 44px;max-width:440px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);color:#e2e8f0;">
            <div id="updateIcon" style="font-size:48px;margin-bottom:16px;">
                <i class="fas fa-spinner fa-spin" style="color:#3b82f6;"></i>
            </div>
            <h2 id="updateTitle" style="margin:0 0 8px;font-size:20px;color:#fff;">Verificando actualizaciones...</h2>
            <p id="updateMessage" style="margin:0 0 20px;font-size:14px;color:#94a3b8;">Conectando con el servidor...</p>
            <div id="updateProgressBar" style="display:none;background:rgba(59,130,246,.15);border-radius:8px;height:8px;margin-bottom:20px;overflow:hidden;">
                <div id="updateProgressFill" style="height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:8px;width:0%;transition:width .3s ease;"></div>
            </div>
            <p id="updatePercent" style="display:none;font-size:13px;color:#64748b;margin:-12px 0 16px;">0%</p>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="btnInstallUpdate" style="display:none;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:12px 28px;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;transition:all .2s;">
                    <i class="fas fa-sync-alt"></i> Instalar y reiniciar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Handler del botón instalar
    document.getElementById('btnInstallUpdate')?.addEventListener('click', async () => {
        pushLog(null, '[UPDATE] Instalando y reiniciando...', 'info');
        await window.api.updaterInstall();
    });

    // Escuchar eventos del updater
    window.api.onUpdaterStatus?.((data) => {
        const overlay = document.getElementById('updateOverlay');
        const icon = document.getElementById('updateIcon');
        const title = document.getElementById('updateTitle');
        const msg = document.getElementById('updateMessage');
        const btnInstall = document.getElementById('btnInstallUpdate');
        const progressBar = document.getElementById('updateProgressBar');
        const progressFill = document.getElementById('updateProgressFill');
        const percentText = document.getElementById('updatePercent');

        switch (data.status) {
            case 'checking':
                // Ya se muestra el spinner al arrancar
                pushLog(null, '[UPDATE] Verificando actualizaciones...', 'info');
                break;

            case 'available':
                // Hay update → mostrar overlay bloqueante (incluso si viene del check de 24h)
                overlay.style.display = 'flex';
                icon.innerHTML = '<i class="fas fa-cloud-download-alt fa-beat" style="color:#3b82f6;"></i>';
                title.textContent = 'Descargando actualización...';
                msg.textContent = `Nueva versión v${data.version} encontrada`;
                progressBar.style.display = '';
                percentText.style.display = '';
                pushLog(null, `[UPDATE] ✅ v${data.version} encontrada, descargando...`, 'success');
                break;

            case 'up-to-date':
                // Todo al día → cerrar overlay y marcar como verificado
                overlay.style.display = 'none';
                sessionStorage.setItem('updateChecked', '1');
                pushLog(null, `[UPDATE] Ya tenés la última versión (v${data.version})`, 'info');
                break;

            case 'downloaded':
                // Descarga lista → obligar a instalar (sin botón "más tarde")
                icon.innerHTML = '🚀';
                title.textContent = '¡Actualización lista!';
                msg.textContent = `La versión v${data.version} se descargó. Instalá para continuar.`;
                progressBar.style.display = 'none';
                percentText.style.display = 'none';
                btnInstall.style.display = '';
                pushLog(null, `[UPDATE] ✅ v${data.version} descargada, lista para instalar`, 'success');
                break;

            case 'error':
            case 'offline':
                // Error o sin internet → dejar usar la app
                overlay.style.display = 'none';
                sessionStorage.setItem('updateChecked', '1');
                pushLog(null, `[UPDATE] ⚠️ No se pudo verificar actualizaciones, continuando...`, 'warning');
                break;
        }
    });

    window.api.onUpdaterProgress?.((data) => {
        const progressFill = document.getElementById('updateProgressFill');
        const percentText = document.getElementById('updatePercent');
        if (progressFill) {
            progressFill.style.width = `${data.percent}%`;
        }
        if (percentText) {
            percentText.textContent = `Descargando... ${data.percent}%`;
        }
    });
}

// Esperar a que cargue el DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
