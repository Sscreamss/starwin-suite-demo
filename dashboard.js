// dashboard.js — Dashboard avanzado con pestañas y filtro por periodo

let allUsers = [];
let filteredUsers = [];
let currentPeriod = 'diario';
let customFrom = null;
let customTo = null;
let charts = {};

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    setupPeriod();
    setupSearch();

    document.getElementById('btnRefresh').addEventListener('click', loadData);
    document.getElementById('btnBack').addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    await loadData();
});

async function loadData() {
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('mainContent').style.display = 'none';

    try {
        allUsers = await window.api.dashboardGetAllUsers();
        applyPeriodFilter();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('mainContent').style.display = '';
    } catch (err) {
        console.error('Error loading dashboard:', err);
        document.getElementById('loading').innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#ef4444;"></i><p>Error cargando datos</p>';
    }
}

// ═══ TABS ═══
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });
}

// ═══ PERIOD ═══
function setupPeriod() {
    document.querySelectorAll('.period-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.period-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');

            const period = pill.dataset.period;
            if (period === 'custom') {
                document.getElementById('customDates').style.display = 'flex';
                return;
            }
            document.getElementById('customDates').style.display = 'none';
            currentPeriod = period;
            customFrom = null;
            customTo = null;
            applyPeriodFilter();
        });
    });

    document.getElementById('btnApplyDates').addEventListener('click', () => {
        const from = document.getElementById('dateFrom').value;
        const to = document.getElementById('dateTo').value;
        if (from && to) {
            customFrom = new Date(from);
            customTo = new Date(to);
            customTo.setHours(23, 59, 59, 999);
            currentPeriod = 'custom';
            applyPeriodFilter();
        }
    });

    // Defaults for custom date inputs
    const today = new Date();
    document.getElementById('dateTo').value = fmt(today);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    document.getElementById('dateFrom').value = fmt(weekAgo);
}

function getPeriodRange() {
    const now = new Date();
    let from, to;

    if (currentPeriod === 'custom' && customFrom && customTo) {
        from = customFrom;
        to = customTo;
    } else if (currentPeriod === 'diario') {
        // Hoy: desde las 00:00 hasta las 23:59
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (currentPeriod === 'semanal') {
        // Esta semana: Lunes a Domingo
        const dayOfWeek = now.getDay(); // 0=domingo
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday, 0, 0, 0, 0);
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (currentPeriod === 'mensual') {
        // Este mes: día 1 hasta hoy
        from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else {
        // Fallback
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    return { from, to };
}

function applyPeriodFilter() {
    const { from, to } = getPeriodRange();

    filteredUsers = allUsers.filter(u => {
        const d = parseDate(u.fecha);
        return d && d >= from && d <= to;
    });

    renderAll(from, to);
}

// ═══ RENDER ALL ═══
function renderAll(from, to) {
    renderResumen(from, to);
    renderUsuarios(from, to);
    renderDepositos(from, to);
    renderLineas(from, to);
}

// ═══ PARSE / FORMAT HELPERS ═══
function parseDate(fecha) {
    if (!fecha) return null;
    const dp = fecha.split(',')[0].trim();
    const p = dp.split('/');
    if (p.length !== 3) return null;
    const [d, m, y] = p.map(Number);
    if (!d || !m || !y) return null;
    return new Date(y, m - 1, d);
}

function fmtKey(date) {
    return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
}

function fmt(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function daysBetween(a, b) {
    return Math.ceil((b - a) / 86400000) + 1;
}

function buildDayMap(from, to) {
    const map = {};
    const days = daysBetween(from, to);
    for (let i = 0; i < days; i++) {
        const d = new Date(from.getTime() + i * 86400000);
        map[fmtKey(d)] = { users: 0, deposits: 0 };
    }
    return map;
}

function esc(s) { const el = document.createElement('span'); el.textContent = s; return el.innerHTML; }

// ═══ CHART DEFAULTS ═══
const CHART_COLORS = { grid: 'rgba(100,116,139,0.08)', tick: '#64748b', tooltip: 'rgba(10,14,26,0.95)' };
function chartOpts(extra = {}) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { display: extra.legend !== undefined ? extra.legend : false, labels: { color: '#94a3b8', font: { size: 11, family: 'DM Sans' } } },
            tooltip: { backgroundColor: CHART_COLORS.tooltip, titleColor: '#e2e8f0', bodyColor: '#e2e8f0', borderColor: 'rgba(59,130,246,0.2)', borderWidth: 1, padding: 10, displayColors: true, bodyFont: { family: 'DM Sans' }, titleFont: { family: 'DM Sans' } }
        },
        scales: extra.scales !== false ? {
            y: { beginAtZero: true, ticks: { color: CHART_COLORS.tick, stepSize: 1, font: { size: 11 } }, grid: { color: CHART_COLORS.grid } },
            x: { ticks: { color: CHART_COLORS.tick, maxRotation: 45, minRotation: 0, font: { size: 10 } }, grid: { display: false } }
        } : undefined,
        ...extra
    };
}

function destroyChart(key) { if (charts[key]) { charts[key].destroy(); charts[key] = null; } }

// ═══ STAT CARD BUILDER ═══
function statCard(label, value, icon, color, sub = '') {
    return `<div class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><div class="stat-icon ${color}"><i class="fas fa-${icon}"></i></div></div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

// ═══ TAB: RESUMEN ═══
function renderResumen(from, to) {
    const total = filteredUsers.length;
    const deps = filteredUsers.filter(u => u.deposito).length;
    const rate = total > 0 ? ((deps / total) * 100).toFixed(1) : 0;
    const allTotal = allUsers.length;
    const allDeps = allUsers.filter(u => u.deposito).length;
    const allRate = allTotal > 0 ? ((allDeps / allTotal) * 100).toFixed(1) : 0;

    document.getElementById('resumenStats').innerHTML =
        statCard('Usuarios (periodo)', total, 'user-plus', 'blue') +
        statCard('Depósitos (periodo)', deps, 'coins', 'green') +
        statCard('Conversión (periodo)', rate + '%', 'percentage', 'amber') +
        statCard('Total histórico', allTotal, 'users', 'purple', `${allDeps} depósitos (${allRate}%)`);

    // Dual chart
    const dayMap = buildDayMap(from, to);
    filteredUsers.forEach(u => {
        const d = parseDate(u.fecha);
        if (!d) return;
        const k = fmtKey(d);
        if (dayMap[k]) {
            dayMap[k].users++;
            if (u.deposito) dayMap[k].deposits++;
        }
    });
    const labels = Object.keys(dayMap);
    const uVals = labels.map(k => dayMap[k].users);
    const dVals = labels.map(k => dayMap[k].deposits);

    destroyChart('dual');
    charts.dual = new Chart(document.getElementById('chartDual'), {
        type: 'line', data: {
            labels,
            datasets: [
                { label: 'Usuarios', data: uVals, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: .4, borderWidth: 2, pointRadius: 3 },
                { label: 'Depósitos', data: dVals, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: .4, borderWidth: 2, pointRadius: 3 }
            ]
        }, options: chartOpts({ legend: true })
    });

    // Conversion donut
    destroyChart('conv');
    charts.conv = new Chart(document.getElementById('chartConversion'), {
        type: 'doughnut', data: {
            labels: ['Depositaron', 'No depositaron'],
            datasets: [{ data: [deps, total - deps], backgroundColor: ['#10b981', 'rgba(100,116,139,0.2)'], borderWidth: 0 }]
        }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16, font: { size: 12, family: 'DM Sans' } } }, tooltip: { backgroundColor: CHART_COLORS.tooltip, titleColor: '#e2e8f0', bodyColor: '#e2e8f0' } } }
    });

    // Recent table (last 10)
    const sorted = [...filteredUsers].sort((a, b) => (parseDate(b.fecha) || 0) - (parseDate(a.fecha) || 0)).slice(0, 10);
    document.getElementById('recentTable').innerHTML = sorted.map(u => `<tr>
        <td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td><td>${esc(u.telefono)}</td><td>${esc(u.fecha)}</td><td>${esc(u.linea)}</td>
        <td><span class="badge ${u.deposito ? 'badge-yes' : 'badge-no'}">${u.deposito ? 'SÍ' : 'NO'}</span></td></tr>`).join('');
}

// ═══ TAB: USUARIOS ═══
let usersPage = 1;
const USERS_PER_PAGE = 20;

function renderUsuarios(from, to) {
    const total = filteredUsers.length;
    const today = new Date();
    const todayKey = fmtKey(today);
    const todayCount = filteredUsers.filter(u => { const d = parseDate(u.fecha); return d && fmtKey(d) === todayKey; }).length;

    document.getElementById('usuariosStats').innerHTML =
        statCard('Total en periodo', total, 'users', 'blue') +
        statCard('Hoy', todayCount, 'calendar-day', 'green') +
        statCard('Promedio diario', total > 0 ? (total / Math.max(1, daysBetween(from, to))).toFixed(1) : '0', 'chart-line', 'amber');

    // Daily chart
    const dayMap = buildDayMap(from, to);
    filteredUsers.forEach(u => { const d = parseDate(u.fecha); if (d) { const k = fmtKey(d); if (dayMap[k]) dayMap[k].users++; } });
    const labels = Object.keys(dayMap);
    const vals = labels.map(k => dayMap[k].users);

    destroyChart('usersDaily');
    charts.usersDaily = new Chart(document.getElementById('chartUsersDaily'), {
        type: 'bar', data: { labels, datasets: [{ label: 'Usuarios', data: vals, backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4 }] },
        options: chartOpts()
    });

    renderUsersTable();
}

function renderUsersTable(search = '') {
    let data = [...filteredUsers].sort((a, b) => (parseDate(b.fecha) || 0) - (parseDate(a.fecha) || 0));
    if (search) {
        const s = search.toLowerCase();
        data = data.filter(u => (u.nombre + u.usuario + u.telefono + u.linea).toLowerCase().includes(s));
    }

    document.getElementById('usersCountLabel').textContent = data.length;
    const pages = Math.ceil(data.length / USERS_PER_PAGE) || 1;
    usersPage = Math.min(usersPage, pages);
    const start = (usersPage - 1) * USERS_PER_PAGE;
    const page = data.slice(start, start + USERS_PER_PAGE);

    document.getElementById('usersTableBody').innerHTML = page.map(u => `<tr>
        <td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td><td style="font-family:monospace;font-size:12px;">${esc(u.password)}</td>
        <td>${esc(u.telefono)}</td><td>${esc(u.fecha)}</td><td>${esc(u.linea)}</td>
        <td><span class="badge ${u.deposito ? 'badge-yes' : 'badge-no'}">${u.deposito ? 'SÍ' : 'NO'}</span></td></tr>`).join('');

    renderPagination('usersPagination', pages, usersPage, p => { usersPage = p; renderUsersTable(document.getElementById('usersSearch').value); });
}

// ═══ TAB: DEPOSITOS ═══
let depsPage = 1;
const DEPS_PER_PAGE = 20;

function renderDepositos(from, to) {
    const deposited = filteredUsers.filter(u => u.deposito);
    const total = filteredUsers.length;
    const rate = total > 0 ? ((deposited.length / total) * 100).toFixed(1) : 0;
    const today = new Date();
    const todayKey = fmtKey(today);
    const depsToday = deposited.filter(u => { const d = parseDate(u.fecha); return d && fmtKey(d) === todayKey; }).length;

    document.getElementById('depositosStats').innerHTML =
        statCard('Depósitos en periodo', deposited.length, 'coins', 'green') +
        statCard('Depósitos hoy', depsToday, 'calendar-check', 'blue') +
        statCard('Tasa de conversión', rate + '%', 'percentage', 'amber') +
        statCard('Sin depositar', total - deposited.length, 'user-clock', 'red');

    // Daily deposits chart
    const dayMap = buildDayMap(from, to);
    deposited.forEach(u => { const d = parseDate(u.fecha); if (d) { const k = fmtKey(d); if (dayMap[k]) dayMap[k].deposits++; } });
    const labels = Object.keys(dayMap);
    const vals = labels.map(k => dayMap[k].deposits);

    destroyChart('depsDaily');
    charts.depsDaily = new Chart(document.getElementById('chartDepositsDaily'), {
        type: 'line', data: { labels, datasets: [{ label: 'Depósitos', data: vals, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: .4, borderWidth: 2, pointRadius: 3 }] },
        options: chartOpts()
    });

    // Conversion by line
    const lineData = {};
    filteredUsers.forEach(u => {
        const l = u.linea || 'Sin línea';
        if (!lineData[l]) lineData[l] = { total: 0, deps: 0 };
        lineData[l].total++;
        if (u.deposito) lineData[l].deps++;
    });
    const lineLabels = Object.keys(lineData).sort();
    const lineRates = lineLabels.map(l => lineData[l].total > 0 ? ((lineData[l].deps / lineData[l].total) * 100).toFixed(1) : 0);

    destroyChart('convByLine');
    charts.convByLine = new Chart(document.getElementById('chartConvByLine'), {
        type: 'bar', data: {
            labels: lineLabels,
            datasets: [{ label: '% Conversión', data: lineRates, backgroundColor: 'rgba(245,158,11,0.6)', borderRadius: 4 }]
        }, options: chartOpts({ scales: { y: { beginAtZero: true, max: 100, ticks: { color: CHART_COLORS.tick, callback: v => v + '%', font: { size: 11 } }, grid: { color: CHART_COLORS.grid } }, x: { ticks: { color: CHART_COLORS.tick, font: { size: 10 } }, grid: { display: false } } } })
    });

    renderDepsTable();
}

function renderDepsTable(search = '') {
    let data = filteredUsers.filter(u => u.deposito).sort((a, b) => (parseDate(b.fecha) || 0) - (parseDate(a.fecha) || 0));
    if (search) {
        const s = search.toLowerCase();
        data = data.filter(u => (u.nombre + u.usuario + u.telefono + u.linea).toLowerCase().includes(s));
    }

    document.getElementById('depsCountLabel').textContent = data.length;
    const pages = Math.ceil(data.length / DEPS_PER_PAGE) || 1;
    depsPage = Math.min(depsPage, pages);
    const start = (depsPage - 1) * DEPS_PER_PAGE;
    const page = data.slice(start, start + DEPS_PER_PAGE);

    document.getElementById('depsTableBody').innerHTML = page.map(u => `<tr>
        <td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td><td>${esc(u.telefono)}</td><td>${esc(u.fecha)}</td><td>${esc(u.linea)}</td></tr>`).join('');

    renderPagination('depsPagination', pages, depsPage, p => { depsPage = p; renderDepsTable(document.getElementById('depsSearch').value); });
}

// ═══ TAB: LINEAS ═══
function renderLineas(from, to) {
    const lineData = {};
    filteredUsers.forEach(u => {
        const l = u.linea || 'Sin línea';
        if (!lineData[l]) lineData[l] = { total: 0, deps: 0, lastDate: null };
        lineData[l].total++;
        if (u.deposito) lineData[l].deps++;
        const d = parseDate(u.fecha);
        if (d && (!lineData[l].lastDate || d > lineData[l].lastDate)) lineData[l].lastDate = d;
    });

    const lines = Object.keys(lineData).sort();
    const activeLine = lines.length;
    const bestLine = lines.reduce((best, l) => (!best || lineData[l].total > lineData[best].total) ? l : best, null);
    const bestConvLine = lines.reduce((best, l) => {
        const rate = lineData[l].total > 0 ? lineData[l].deps / lineData[l].total : 0;
        const bestRate = best ? (lineData[best].total > 0 ? lineData[best].deps / lineData[best].total : 0) : 0;
        return rate > bestRate ? l : best;
    }, null);

    document.getElementById('lineasStats').innerHTML =
        statCard('Líneas activas', activeLine, 'project-diagram', 'blue') +
        statCard('Más productiva', bestLine || '-', 'trophy', 'amber', bestLine ? `${lineData[bestLine].total} usuarios` : '') +
        statCard('Mejor conversión', bestConvLine || '-', 'bullseye', 'green', bestConvLine ? `${((lineData[bestConvLine].deps / lineData[bestConvLine].total) * 100).toFixed(0)}%` : '');

    // Bar chart
    const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#14b8a6'];
    destroyChart('linesBar');
    charts.linesBar = new Chart(document.getElementById('chartLinesBar'), {
        type: 'bar', data: {
            labels: lines,
            datasets: [
                { label: 'Usuarios', data: lines.map(l => lineData[l].total), backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4 },
                { label: 'Depósitos', data: lines.map(l => lineData[l].deps), backgroundColor: 'rgba(16,185,129,0.6)', borderRadius: 4 }
            ]
        }, options: chartOpts({ legend: true })
    });

    // Table
    document.getElementById('linesTableBody').innerHTML = lines.map(l => {
        const d = lineData[l];
        const rate = d.total > 0 ? ((d.deps / d.total) * 100).toFixed(1) : '0.0';
        const lastStr = d.lastDate ? `${String(d.lastDate.getDate()).padStart(2,'0')}/${String(d.lastDate.getMonth()+1).padStart(2,'0')}/${d.lastDate.getFullYear()}` : '-';
        return `<tr><td>${esc(l)}</td><td>${d.total}</td><td>${d.deps}</td><td>${rate}%</td><td>${lastStr}</td></tr>`;
    }).join('');
}

// ═══ PAGINATION ═══
function renderPagination(containerId, totalPages, current, onPage) {
    const container = document.getElementById(containerId);
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    let html = '';
    const maxShow = 7;
    let start = Math.max(1, current - 3);
    let end = Math.min(totalPages, start + maxShow - 1);
    if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1);

    if (current > 1) html += `<button class="page-btn" data-p="${current-1}">‹</button>`;
    for (let i = start; i <= end; i++) {
        html += `<button class="page-btn ${i === current ? 'active' : ''}" data-p="${i}">${i}</button>`;
    }
    if (current < totalPages) html += `<button class="page-btn" data-p="${current+1}">›</button>`;
    container.innerHTML = html;

    container.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', () => onPage(parseInt(btn.dataset.p)));
    });
}

// ═══ SEARCH ═══
function setupSearch() {
    document.getElementById('usersSearch').addEventListener('input', e => { usersPage = 1; renderUsersTable(e.target.value); });
    document.getElementById('depsSearch').addEventListener('input', e => { depsPage = 1; renderDepsTable(e.target.value); });
}