// config.js - Configuración visual de mensajes (UI mejorada con tabs + búsqueda)
let currentConfig = null;

const DEFAULTS = {
  // Welcome
  welcomeOptionsLine: "Responde con: INFORMACION, CREAR USUARIO o ASISTENCIA",

  // Depósito (nuevos campos)
  bankDetailsMessage:
    "Perfecto! Te paso los datos bancarios:\n" +
    "👤 TITULAR: Angelica Vanesa Mendoza\n" +
    "ALIAS: muguet.pausado.lemon\n" +
    "⬇️⬇️⬇️",
  cbuMessage: "0000168300000024246152",
  askProofMessage: "📸 Ahora enviá por acá la *foto del comprobante*.",
  proofRedirectMessage:
    "Estas listo para comenzar! 🥳\n" +
    "Ahora te derivo con nuestra línea de caja principal para acreditar tu carga.\n" +
    "Hacé clic en el número para comunicarte por WhatsApp:\n" +
    "⬇️⬇️⬇️\n\n" +
    "+54 9 11 7133-2551\n\n" +
    "Por favor, enviá por ese medio:\n" +
    "-Tu nombre de usuario\n" +
    "-El comprobante de pago\n" +
    "-El nombre del titular de la cuenta\n" +
    "¡Gracias y muchísima suerte!",
  depositNoMessage:
    "👍 No hay problema. Puedes depositar cuando quieras desde tu cuenta.\n\n" +
    "¡Nos vemos en el juego!\n\n" +
    "Para mandar tu primera carga escribí: Deposito"
};

function $(id) {
  return document.getElementById(id);
}

function normalizeText(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function loadConfig() {
  try {
    currentConfig = await window.api.configGet();
    populateForm();
    initUI();
  } catch (error) {
    showAlert("Error cargando configuración: " + error.message, "error");
  }
}

function populateForm() {
  if (!currentConfig) return;

  // Mensajes
  const welcomeMsg = currentConfig.menu?.welcome || "";
  const parts = welcomeMsg.split("\n\n");
  const welcomeText = parts[0] || welcomeMsg.split("Responde con:")[0] || welcomeMsg;

  $("welcomeMessage").value = (welcomeText || "").trim();

  // Intentamos leer la línea de opciones desde el config (si existe)
  // Si no, usamos default
  let optionsLine = DEFAULTS.welcomeOptionsLine;
  if (parts.length > 1) {
    // heurística: el resto del mensaje suele ser la línea de opciones
    const rest = parts.slice(1).join("\n\n").trim();
    if (rest.length > 0) optionsLine = rest;
  }
  $("welcomeOptionsLine").value = (currentConfig.menu?.welcomeOptionsLine || optionsLine || "").trim();

  $("infoMessage").value = currentConfig.info?.text || "";
  $("supportMessage").value = currentConfig.support?.text || "";

  // Usuarios
  $("fixedPassword").value = currentConfig.fixedPassword || "";
  $("usernameSuffix").value = currentConfig.usernameSuffix || "";
  $("siteUrl").value = currentConfig.url || "";

  $("createdMessage").value = currentConfig.createUser?.createdTemplate || "";

  // Depósito: ahora los campos usados por el flujo
  const cu = currentConfig.createUser || {};
  $("bankDetailsMessage").value = cu.bankDetailsMessage || DEFAULTS.bankDetailsMessage;
  $("cbuMessage").value = cu.cbuMessage || DEFAULTS.cbuMessage;
  $("askProofMessage").value = cu.askProofMessage || DEFAULTS.askProofMessage;
  $("proofRedirectMessage").value = cu.proofRedirectMessage || DEFAULTS.proofRedirectMessage;

  // depositNo (texto final cuando responde NO)
  $("depositNoMessage").value = (cu.depositNoMessage || cu.depositNo || DEFAULTS.depositNoMessage);

  updateCharCounts();
  updatePreview();
}

function updateCharCounts() {
  const fields = [
    { id: "welcomeMessage", countId: "welcomeCount", max: 700 },
    { id: "welcomeOptionsLine", countId: "welcomeOptionsCount", max: 200 },
    { id: "infoMessage", countId: "infoCount", max: 1500 },
    { id: "supportMessage", countId: "supportCount", max: 1500 },

    { id: "fixedPassword", countId: "fixedPasswordCount", max: 50 },
    { id: "usernameSuffix", countId: "usernameSuffixCount", max: 20 },
    { id: "siteUrl", countId: "siteUrlCount", max: 300 },

    { id: "createdMessage", countId: "createdCount", max: 2000 },

    { id: "bankDetailsMessage", countId: "bankDetailsCount", max: 1200 },
    { id: "cbuMessage", countId: "cbuCount", max: 60 },
    { id: "askProofMessage", countId: "askProofCount", max: 800 },
    { id: "depositNoMessage", countId: "depositNoCount", max: 800 },
    { id: "proofRedirectMessage", countId: "proofRedirectCount", max: 2000 }
  ];

  fields.forEach((field) => {
    const input = $(field.id);
    const counter = $(field.countId);
    if (!input || !counter) return;

    const length = (input.value || "").length;
    counter.textContent = `${length} / ${field.max}`;
    counter.style.color = length > field.max * 0.9 ? "#f59e0b" : "#64748b";
  });
}

function updatePreview() {
  const template = $("createdMessage").value || "";
  const password = $("fixedPassword").value || "Hola1234";
  const url = $("siteUrl").value || "https://admin.starwin.plus";
  const suffix = $("usernameSuffix").value || "_starwin";

  const preview = template
    .replace(/\{\{username\}\}/g, `martin4479${suffix}`)
    .replace(/\{\{password\}\}/g, password)
    .replace(/\{\{email\}\}/g, `martin4479${suffix}@admin.starwin.plus`) // por si quedó en template viejo
    .replace(/\{\{url\}\}/g, url);

  $("previewMessage").textContent = preview;
}

async function saveConfig() {
  try {
    const welcomeText = $("welcomeMessage").value.trim();
    const optionsLine = $("welcomeOptionsLine").value.trim() || DEFAULTS.welcomeOptionsLine;

    const fullWelcomeMessage = `${welcomeText}\n\n${optionsLine}`;

    const updates = {
      menu: {
        welcome: fullWelcomeMessage,
        // guardamos también la línea separada por si querés leerla directo
        welcomeOptionsLine: optionsLine
      },
      info: {
        text: $("infoMessage").value.trim()
      },
      support: {
        text: $("supportMessage").value.trim()
      },

      // Parámetros de usuario
      fixedPassword: $("fixedPassword").value.trim(),
      usernameSuffix: $("usernameSuffix").value.trim(),
      url: $("siteUrl").value.trim(),

      // Textos de creación y depósito
      createUser: {
        ...currentConfig.createUser,
        createdTemplate: $("createdMessage").value.trim(),

        // NUEVOS: textos del flujo depósito (usados por el engine)
        bankDetailsMessage: $("bankDetailsMessage").value.trim(),
        cbuMessage: $("cbuMessage").value.trim(),
        askProofMessage: $("askProofMessage").value.trim(),
        proofRedirectMessage: $("proofRedirectMessage").value.trim(),

        // Mensaje NO depósito (nuevo nombre + compat con viejo)
        depositNoMessage: $("depositNoMessage").value.trim(),
        depositNo: $("depositNoMessage").value.trim()
      }
    };

    await window.api.configSet(updates);

    showAlert("✅ Configuración guardada exitosamente", "success");

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1200);
  } catch (error) {
    showAlert("❌ Error guardando: " + error.message, "error");
  }
}

function showAlert(message, type) {
  const container = $("alertContainer");
  const alert = document.createElement("div");
  alert.className = `alert alert-${type} show`;
  alert.innerHTML = `
    <i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}"></i>
    <span>${message}</span>
  `;
  container.innerHTML = "";
  container.appendChild(alert);

  if (type === "success") {
    setTimeout(() => alert.classList.remove("show"), 2600);
  }
}

/* ---------------------------
   UI: Tabs + Búsqueda
---------------------------- */

function initUI() {
  // Tabs
  const navButtons = document.querySelectorAll(".nav button");
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      navButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tabId = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      const tab = document.getElementById(tabId);
      if (tab) tab.classList.add("active");

      // limpiar búsqueda al cambiar de tab (opcional)
      // $("searchInput").value = "";
      // applySearchFilter("");
    });
  });

  // Búsqueda: filtra inputs/textarea por data-search y también salta al tab correspondiente
  const searchInput = $("searchInput");
  searchInput.addEventListener("input", (e) => {
    applySearchFilter(e.target.value);
  });
}

function applySearchFilter(raw) {
  const q = normalizeText(raw);
  const fields = document.querySelectorAll("textarea[data-search], input[data-search]");

  if (!q) {
    fields.forEach((el) => {
      el.closest(".form-group").style.display = "";
    });
    return;
  }

  fields.forEach((el) => {
    const keys = normalizeText(el.getAttribute("data-search") || "");
    const match = keys.includes(q);

    el.closest(".form-group").style.display = match ? "" : "none";
  });

  // Si hay resultados en un tab no activo, activarlo automáticamente al primer match
  const firstMatch = Array.from(fields).find((el) => {
    const keys = normalizeText(el.getAttribute("data-search") || "");
    return keys.includes(q);
  });

  if (firstMatch) {
    const tab = firstMatch.closest(".tab");
    if (tab && !tab.classList.contains("active")) {
      // activar el tab
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // activar botón correspondiente
      const tabId = tab.id;
      const btn = document.querySelector(`.nav button[data-tab="${tabId}"]`);
      if (btn) {
        document.querySelectorAll(".nav button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      }
    }
  }
}

/* ---------------------------
   Event listeners
---------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  loadConfig();

  // Contadores + preview
  const inputs = document.querySelectorAll("textarea, input");
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      updateCharCounts();

      if (
        input.id === "createdMessage" ||
        input.id === "fixedPassword" ||
        input.id === "siteUrl" ||
        input.id === "usernameSuffix"
      ) {
        updatePreview();
      }
    });
  });

  $("btnSave").addEventListener("click", saveConfig);

  $("btnCancel").addEventListener("click", () => {
    if (confirm("¿Descartar cambios y volver al dashboard?")) {
      window.location.href = "index.html";
    }
  });
});
