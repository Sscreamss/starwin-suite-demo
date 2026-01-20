const state = {
  lines: [],
  selected: "line-01",
  qr: {},        // lineId -> dataUrl
  status: {},    // lineId -> status obj
  console: []
};

function log(line) {
  state.console.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
  state.console = state.console.slice(0, 200);
  render();
}

function statusLabel(st) {
  const s = st?.state || "STOPPED";
  return s;
}

async function refreshLines() {
  const list = await window.api.linesList();
  state.lines = list;
  for (const item of list) {
    state.status[item.lineId] = item.status;
  }
  render();
}

function render() {
  const el = document.getElementById("app");
  const linesHtml = state.lines.map(x => {
    const isActive = x.lineId === state.selected;
    const st = state.status[x.lineId];
    return `
      <div class="item ${isActive ? "active" : ""}" data-line="${x.lineId}">
        <div>
          <div class="big">${x.lineId}</div>
          <div class="small">${statusLabel(st)}</div>
        </div>
        <div class="row">
          <button class="btn primary" data-act="start" data-line="${x.lineId}">Iniciar</button>
          <button class="btn danger" data-act="stop" data-line="${x.lineId}">Detener</button>
        </div>
      </div>
    `;
  }).join("");

  const sel = state.selected;
  const st = state.status[sel] || { state: "STOPPED" };
  const qr = state.qr[sel];

  el.innerHTML = `
    <div class="wrap">
      <div class="card">
        <h1>Líneas WhatsApp</h1>
        <h2>30 sesiones independientes · LocalAuth persistente</h2>
        <div style="height:10px"></div>
        <div class="list">${linesHtml || `<div class="small">Cargando…</div>`}</div>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <h1>${sel}</h1>
            <div class="pill">Estado: ${statusLabel(st)}</div>
          </div>
          <div class="row">
            <button id="btnRefresh" class="btn">Refrescar</button>
          </div>
        </div>

        <div style="height:12px"></div>

        <h3>QR / Sesión</h3>
        <div class="qrBox">
          ${
            qr
              ? `<img src="${qr}" alt="QR" />`
              : `<div class="small">Si el estado es QR, debería aparecer acá.</div>`
          }
        </div>

        <div style="height:12px"></div>
        <h3>Consola</h3>
        <div class="console">${state.console.join("\n")}</div>
      </div>
    </div>
  `;

  bind();
}

function bind() {
  document.querySelectorAll("[data-line]").forEach((node) => {
    node.addEventListener("click", (e) => {
      const lineId = node.getAttribute("data-line");
      state.selected = lineId;
      render();
    });
  });

  document.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const act = btn.getAttribute("data-act");
      const lineId = btn.getAttribute("data-line");

      try {
        if (act === "start") {
          log(`Iniciando ${lineId}...`);
          await window.api.linesStart(lineId);
        } else {
          log(`Deteniendo ${lineId}...`);
          await window.api.linesStop(lineId);
        }
      } catch (err) {
        log(`ERROR ${act} ${lineId}: ${err?.message || String(err)}`);
      }
    });
  });

  const btnRefresh = document.getElementById("btnRefresh");
  if (btnRefresh) btnRefresh.addEventListener("click", refreshLines);
}

// ---- Events from main ----
window.api.onLineQr(({ lineId, dataUrl }) => {
  state.qr[lineId] = dataUrl;
  log(`QR recibido para ${lineId}`);
  render();
});

window.api.onLineStatus(({ lineId, status }) => {
  state.status[lineId] = status;
  log(`Status ${lineId}: ${statusLabel(status)}`);
  render();
});

window.api.onLineMessage(({ lineId, message }) => {
  log(`MSG ${lineId} <- ${message.from}: ${message.body}`);
});

window.api.onLogEvent((entry) => {
  log(`BOT ${entry.type} (${entry.lineId})`);
});

// Init
(async function init() {
  await refreshLines();
  render();
})();
