// titlebar.js - Barra de título custom para todas las páginas
// Se inyecta automáticamente al cargar

(function() {
    // Crear titlebar
    const titlebar = document.createElement('div');
    titlebar.id = 'customTitlebar';
    titlebar.innerHTML = `
        <div class="titlebar-drag">
            <div class="titlebar-icon">
                <i class="fas fa-robot"></i>
            </div>
            <span class="titlebar-title">BotDash</span>
        </div>
        <div class="titlebar-controls">
            <button class="titlebar-btn" id="titlebarMin" title="Minimizar">
                <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" rx="0.75" fill="currentColor"/></svg>
            </button>
            <button class="titlebar-btn" id="titlebarMax" title="Maximizar">
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
            </button>
            <button class="titlebar-btn titlebar-btn-close" id="titlebarClose" title="Cerrar">
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
        </div>
    `;

    // Inyectar estilos
    const style = document.createElement('style');
    style.textContent = `
        #customTitlebar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 36px;
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(10, 15, 30, 0.95);
            border-bottom: 1px solid rgba(59, 130, 246, 0.15);
            user-select: none;
            -webkit-app-region: drag;
        }

        .titlebar-drag {
            display: flex;
            align-items: center;
            gap: 8px;
            padding-left: 14px;
            flex: 1;
        }

        .titlebar-icon {
            color: #3b82f6;
            font-size: 14px;
        }

        .titlebar-title {
            font-size: 12px;
            font-weight: 600;
            color: #94a3b8;
            letter-spacing: 0.3px;
        }

        .titlebar-controls {
            display: flex;
            -webkit-app-region: no-drag;
        }

        .titlebar-btn {
            width: 46px;
            height: 36px;
            border: none;
            background: transparent;
            color: #94a3b8;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, color 0.15s;
        }

        .titlebar-btn:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #e2e8f0;
        }

        .titlebar-btn-close:hover {
            background: #ef4444;
            color: #ffffff;
        }

        /* Offset para que el contenido no quede debajo de la titlebar */
        body {
            padding-top: 36px !important;
        }

        /* Fix para index.html que usa height:100vh */
        .dashboard {
            height: calc(100vh - 36px) !important;
        }
    `;

    // Insertar en el DOM
    document.head.appendChild(style);
    document.body.prepend(titlebar);

    // Event listeners
    document.getElementById('titlebarMin')?.addEventListener('click', () => {
        window.api?.windowMinimize();
    });

    document.getElementById('titlebarMax')?.addEventListener('click', () => {
        window.api?.windowMaximize();
    });

    document.getElementById('titlebarClose')?.addEventListener('click', () => {
        window.api?.windowClose();
    });

    // Doble click en la barra = maximizar/restaurar
    titlebar.addEventListener('dblclick', (e) => {
        if (e.target.closest('.titlebar-controls')) return;
        window.api?.windowMaximize();
    });
})();