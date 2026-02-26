// dashboard.js
let chartUsers = null;
let chartLines = null;

// Cargar datos al iniciar
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    
    // Event listeners
    document.getElementById('btnRefresh').addEventListener('click', loadDashboard);
    document.getElementById('btnBack').addEventListener('click', () => {
        window.location.href = 'index.html';
    });
});

async function loadDashboard() {
    try {
        showLoading(true);
        
        // Obtener datos desde main process
        const stats = await window.api.dashboardGetStats();
        const usersByDay = await window.api.dashboardGetUsersByDay(30);
        const recentUsers = await window.api.dashboardGetRecentUsers(10);
        
        // Renderizar stats
        renderStats(stats);
        
        // Renderizar gráficos
        renderUsersChart(usersByDay);
        renderLinesChart(stats.byLine);
        
        // Renderizar tabla
        renderUsersTable(recentUsers);
        
        showLoading(false);
    } catch (error) {
        console.error('Error cargando dashboard:', error);
        alert('Error cargando datos: ' + error.message);
        showLoading(false);
    }
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
    document.getElementById('content').style.display = show ? 'none' : 'block';
}

function renderStats(stats) {
    document.getElementById('statTotal').textContent = stats.total || 0;
    document.getElementById('statToday').textContent = stats.today || 0;
    document.getElementById('statWeek').textContent = stats.thisWeek || 0;
    document.getElementById('statDeposited').textContent = stats.deposited || 0;
    document.getElementById('depositRate').textContent = stats.depositRate + '%';
    document.getElementById('statDepositedToday').textContent = stats.depositedToday || 0;
    document.getElementById('statDepositedWeek').textContent = stats.depositedThisWeek || 0;
}

function renderUsersChart(data) {
    const ctx = document.getElementById('chartUsers');
    
    if (chartUsers) {
        chartUsers.destroy();
    }
    
    const labels = data.map(d => d.date);
    const values = data.map(d => d.count);
    
    chartUsers = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Usuarios Creados',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#e2e8f0',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#64748b',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(100, 116, 139, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#64748b',
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderLinesChart(byLine) {
    const ctx = document.getElementById('chartLines');
    
    if (chartLines) {
        chartLines.destroy();
    }
    
    const labels = Object.keys(byLine);
    const values = Object.values(byLine);
    
    const colors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'
    ];
    
    chartLines = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#e2e8f0',
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#e2e8f0',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    padding: 12
                }
            }
        }
    });
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">No hay usuarios registrados</td></tr>';
        return;
    }
    
    users.forEach(user => {
        const row = document.createElement('tr');
        
        // ✅ FIX: Mostrar teléfono completo (ya viene limpio del backend)
        const phone = user.telefono || 'N/A';
        
        row.innerHTML = `
            <td>${escapeHtml(user.nombre || 'N/A')}</td>
            <td><code>${escapeHtml(user.usuario || 'N/A')}</code></td>
            <td>${escapeHtml(phone)}</td>
            <td>${escapeHtml(user.fecha || 'N/A')}</td>
            <td><span class="badge badge-success">${escapeHtml(user.linea || 'N/A')}</span></td>
            <td>
                <span class="badge ${user.deposito ? 'badge-success' : 'badge-danger'}">
                    ${user.deposito ? 'SÍ' : 'NO'}
                </span>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}