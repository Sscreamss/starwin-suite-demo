// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const cookieStatusEl = document.getElementById('cookieStatus');
  const timestampEl = document.getElementById('timestamp');
  const capturedTimeEl = document.getElementById('capturedTime');
  const clearBtn = document.getElementById('clearBtn');

  // Verificar estado
  const data = await chrome.storage.local.get(['cfClearance', 'captured', 'capturedAt']);

  if (data.captured && data.cfClearance) {
    statusEl.textContent = '✅ Cookie capturada';
    statusEl.className = 'success';
    
    const cookieValue = data.cfClearance.value;
    cookieStatusEl.textContent = cookieValue.substring(0, 20) + '...';
    cookieStatusEl.className = 'success';
    
    if (data.capturedAt) {
      const date = new Date(data.capturedAt);
      capturedTimeEl.textContent = date.toLocaleString();
      timestampEl.style.display = 'block';
    }
  } else {
    statusEl.textContent = '⏳ Esperando...';
    statusEl.className = 'waiting';
    cookieStatusEl.textContent = 'No capturada aún';
  }

  // Botón limpiar
  clearBtn.addEventListener('click', async () => {
    await chrome.storage.local.clear();
    statusEl.textContent = '🔄 Datos limpiados';
    cookieStatusEl.textContent = 'No capturada';
    timestampEl.style.display = 'none';
  });
});
