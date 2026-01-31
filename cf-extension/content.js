// content.js - Muestra notificaciones visuales en la página

// Crear banner de notificación
function createNotificationBanner(message, type = 'success') {
  const existing = document.getElementById('cf-capture-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'cf-capture-banner';
  banner.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'};
    color: white;
    padding: 20px 30px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slideIn 0.3s ease-out;
  `;

  const icon = document.createElement('span');
  icon.style.fontSize = '24px';
  icon.textContent = type === 'success' ? '✅' : '⏳';

  const text = document.createElement('span');
  text.textContent = message;

  banner.appendChild(icon);
  banner.appendChild(text);
  document.body.appendChild(banner);

  // Agregar animación
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // Auto-remover después de 3 segundos (si es success)
  if (type === 'success') {
    setTimeout(() => {
      banner.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => banner.remove(), 300);
    }, 3000);
  }
}

// Escuchar mensajes del background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COOKIE_CAPTURED') {
    createNotificationBanner(message.message, 'success');
    sendResponse({ ok: true });
  }
  return true;
});

// Mostrar banner inicial
setTimeout(() => {
  createNotificationBanner('⏳ Esperando resolución de Cloudflare...', 'info');
}, 1000);

// Verificar cookie cada 2 segundos
const checkInterval = setInterval(() => {
  chrome.runtime.sendMessage({ type: 'CHECK_COOKIE' });
}, 2000);

// Limpiar intervalo cuando se cierra la página
window.addEventListener('beforeunload', () => {
  clearInterval(checkInterval);
});

console.log('[CF Capture Content] Script loaded');
