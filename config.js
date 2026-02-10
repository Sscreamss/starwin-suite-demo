// config.js - Configuración visual (v3 - etiqueta + dato separados + imagen depósito)
let currentConfig = null;

const DEFAULTS = {
  bankDetailsMessage: "Perfecto! Te paso los datos bancarios:\n👤 TITULAR: Angelica Vanesa Mendoza\nALIAS: muguet.pausado.lemon\n⬇️⬇️⬇️",
  cbuMessage: "0000168300000024246152",
  askProofMessage: "📸 Ahora enviá por acá la *foto del comprobante*.",
  proofRedirectMessage: "Estas listo para comenzar! 🥳\nAhora te derivo con nuestra línea de caja principal para acreditar tu carga.\nHacé clic en el número para comunicarte por WhatsApp:\n⬇️⬇️⬇️\n\n+54 9 11 7133-2551\n\nPor favor, enviá por ese medio:\n-Tu nombre de usuario\n-El comprobante de pago\n-El nombre del titular de la cuenta\n¡Gracias y muchísima suerte!",
  depositNoMessage: "👍 No hay problema. Puedes depositar cuando quieras desde tu cuenta.\n\n¡Nos vemos en el juego!\n\nPara mandar tu primera carga escribí: Deposito",
  askName: "Buenas, me dirías tu nombre por favor?",
  invalidName: "❌ Nombre inválido. Debe tener entre 2 y 30 caracteres, solo letras y espacios.",
  creating: "⏳ Creando tu usuario en Starwin...",
  askDeposit: "¿Deseas realizar un depósito ahora? Responde SI o NO",
  createdUserLabel: "👤 Tu usuario es:",
  createdPassLabel: "🔑 Tu contraseña es:",
  createdUrlLabel: "🌐 Ingresá acá:"
};

function $(id) { return document.getElementById(id); }

function normalizeText(input) {
  return String(input || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function loadConfig() {
  try {
    currentConfig = await window.api.configGet();
    populateForm();
    initUI();
    loadDepositImage(); // ✅ NUEVO: cargar preview de imagen
  } catch (error) {
    showAlert("Error cargando configuración: " + error.message, "error");
  }
}

function populateForm() {
  if (!currentConfig) return;
  const cu = currentConfig.createUser || {};

  $("askNameMessage").value = cu.askName || DEFAULTS.askName;
  $("invalidNameMessage").value = cu.invalidName || DEFAULTS.invalidName;
  $("creatingMessage").value = cu.creating || DEFAULTS.creating;
  $("askDepositMessage").value = cu.askDeposit || DEFAULTS.askDeposit;
  $("fixedPassword").value = currentConfig.fixedPassword || "";
  $("usernameSuffix").value = currentConfig.usernameSuffix || "";
  $("siteUrl").value = currentConfig.url || "";
  $("createdUserLabel").value = cu.createdUserLabel || DEFAULTS.createdUserLabel;
  $("createdPassLabel").value = cu.createdPassLabel || DEFAULTS.createdPassLabel;
  $("createdUrlLabel").value = cu.createdUrlLabel || DEFAULTS.createdUrlLabel;
  $("infoMessage").value = currentConfig.info?.text || "";
  $("supportMessage").value = currentConfig.support?.text || "";
  $("bankDetailsMessage").value = cu.bankDetailsMessage || DEFAULTS.bankDetailsMessage;
  $("cbuMessage").value = cu.cbuMessage || DEFAULTS.cbuMessage;
  $("askProofMessage").value = cu.askProofMessage || DEFAULTS.askProofMessage;
  $("proofRedirectMessage").value = cu.proofRedirectMessage || DEFAULTS.proofRedirectMessage;
  $("depositNoMessage").value = cu.depositNoMessage || cu.depositNo || DEFAULTS.depositNoMessage;

  updateCharCounts();
  updatePreview();
}

function updateCharCounts() {
  var fields = [
    { id: "askNameMessage", countId: "askNameCount", max: 500 },
    { id: "invalidNameMessage", countId: "invalidNameCount", max: 500 },
    { id: "creatingMessage", countId: "creatingCount", max: 200 },
    { id: "askDepositMessage", countId: "askDepositCount", max: 500 },
    { id: "fixedPassword", countId: "fixedPasswordCount", max: 50 },
    { id: "usernameSuffix", countId: "usernameSuffixCount", max: 20 },
    { id: "siteUrl", countId: "siteUrlCount", max: 300 },
    { id: "createdUserLabel", countId: "createdUserLabelCount", max: 200 },
    { id: "createdPassLabel", countId: "createdPassLabelCount", max: 200 },
    { id: "createdUrlLabel", countId: "createdUrlLabelCount", max: 200 },
    { id: "infoMessage", countId: "infoCount", max: 1500 },
    { id: "supportMessage", countId: "supportCount", max: 1500 },
    { id: "bankDetailsMessage", countId: "bankDetailsCount", max: 1200 },
    { id: "cbuMessage", countId: "cbuCount", max: 60 },
    { id: "askProofMessage", countId: "askProofCount", max: 800 },
    { id: "depositNoMessage", countId: "depositNoCount", max: 800 },
    { id: "proofRedirectMessage", countId: "proofRedirectCount", max: 2000 }
  ];
  fields.forEach(function(field) {
    var input = $(field.id);
    var counter = $(field.countId);
    if (!input || !counter) return;
    var length = (input.value || "").length;
    counter.textContent = length + " / " + field.max;
    counter.style.color = length > field.max * 0.9 ? "#f59e0b" : "#64748b";
  });
}

function updatePreview() {
  var password = $("fixedPassword").value || "Hola1234";
  var url = $("siteUrl").value || "https://admin.starwin.plus";
  var suffix = $("usernameSuffix").value || "_starwin";
  var exampleUser = "martin4479" + suffix;

  var lbl1 = $("createdUserLabel").value || DEFAULTS.createdUserLabel;
  var lbl2 = $("createdPassLabel").value || DEFAULTS.createdPassLabel;
  var lbl3 = $("createdUrlLabel").value || DEFAULTS.createdUrlLabel;

  var preview =
    "📱 Mensaje 1:  " + lbl1 + "\n" +
    "📱 Mensaje 2:  " + exampleUser + "\n\n" +
    "📱 Mensaje 3:  " + lbl2 + "\n" +
    "📱 Mensaje 4:  " + password + "\n\n" +
    "📱 Mensaje 5:  " + lbl3 + "\n" +
    "📱 Mensaje 6:  " + url;

  $("previewMessages").textContent = preview;
}

async function saveConfig() {
  try {
    var updates = {
      info: { text: $("infoMessage").value.trim() },
      support: { text: $("supportMessage").value.trim() },
      fixedPassword: $("fixedPassword").value.trim(),
      usernameSuffix: $("usernameSuffix").value.trim(),
      url: $("siteUrl").value.trim(),
      createUser: {
        ...(currentConfig.createUser || {}),
        askName: $("askNameMessage").value.trim(),
        invalidName: $("invalidNameMessage").value.trim(),
        creating: $("creatingMessage").value.trim(),
        askDeposit: $("askDepositMessage").value.trim(),
        createdUserLabel: $("createdUserLabel").value.trim(),
        createdPassLabel: $("createdPassLabel").value.trim(),
        createdUrlLabel: $("createdUrlLabel").value.trim(),
        bankDetailsMessage: $("bankDetailsMessage").value.trim(),
        cbuMessage: $("cbuMessage").value.trim(),
        askProofMessage: $("askProofMessage").value.trim(),
        proofRedirectMessage: $("proofRedirectMessage").value.trim(),
        depositNoMessage: $("depositNoMessage").value.trim(),
        depositNo: $("depositNoMessage").value.trim()
      }
    };
    await window.api.configSet(updates);
    showAlert("✅ Configuración guardada exitosamente", "success");
    setTimeout(function() { window.location.href = "index.html"; }, 1200);
  } catch (error) {
    showAlert("❌ Error guardando: " + error.message, "error");
  }
}

function showAlert(message, type) {
  var container = $("alertContainer");
  var alert = document.createElement("div");
  alert.className = "alert alert-" + type + " show";
  alert.innerHTML = '<i class="fas fa-' + (type === "success" ? "check-circle" : "exclamation-circle") + '"></i><span>' + message + "</span>";
  container.innerHTML = "";
  container.appendChild(alert);
  if (type === "success") { setTimeout(function() { alert.classList.remove("show"); }, 2600); }
}

function initUI() {
  var navButtons = document.querySelectorAll(".nav button");
  navButtons.forEach(function(btn) {
    btn.addEventListener("click", function() {
      navButtons.forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var tabId = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
      var tab = document.getElementById(tabId);
      if (tab) tab.classList.add("active");
    });
  });
  $("searchInput").addEventListener("input", function(e) { applySearchFilter(e.target.value); });
}

function applySearchFilter(raw) {
  var q = normalizeText(raw);
  var fields = document.querySelectorAll("textarea[data-search], input[data-search]");
  if (!q) { fields.forEach(function(el) { el.closest(".form-group").style.display = ""; }); return; }
  fields.forEach(function(el) {
    var keys = normalizeText(el.getAttribute("data-search") || "");
    el.closest(".form-group").style.display = keys.includes(q) ? "" : "none";
  });
  var firstMatch = Array.from(fields).find(function(el) {
    return normalizeText(el.getAttribute("data-search") || "").includes(q);
  });
  if (firstMatch) {
    var tab = firstMatch.closest(".tab");
    if (tab && !tab.classList.contains("active")) {
      document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
      tab.classList.add("active");
      var tabId = tab.id;
      var btn = document.querySelector('.nav button[data-tab="' + tabId + '"]');
      if (btn) {
        document.querySelectorAll(".nav button").forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
      }
    }
  }
}

// ✅ NUEVO: Deposit Image handlers
async function loadDepositImage() {
  try {
    const res = await window.api.configGetDepositImage();
    const preview = $("depositImagePreview");
    const removeBtn = $("btnRemoveDepositImage");
    
    if (!preview) return;

    if (res?.ok && res.dataUrl) {
      preview.innerHTML = '<img src="' + res.dataUrl + '" alt="Imagen de depósito">';
      if (removeBtn) removeBtn.style.display = "inline-flex";
    } else {
      preview.innerHTML = '<div class="image-placeholder"><i class="fas fa-image"></i><span>Sin imagen configurada</span></div>';
      if (removeBtn) removeBtn.style.display = "none";
    }
  } catch (err) {
    console.error("Error cargando imagen:", err);
  }
}

document.addEventListener("DOMContentLoaded", function() {
  loadConfig();
  document.querySelectorAll("textarea, input").forEach(function(input) {
    input.addEventListener("input", function() {
      updateCharCounts();
      if (["createdUserLabel","createdPassLabel","createdUrlLabel","fixedPassword","siteUrl","usernameSuffix"].indexOf(input.id) !== -1) {
        updatePreview();
      }
    });
  });
  $("btnSave").addEventListener("click", saveConfig);
  $("btnCancel").addEventListener("click", function() {
    if (confirm("¿Descartar cambios y volver al dashboard?")) { window.location.href = "index.html"; }
  });

  // ✅ NUEVO: Botones de imagen de depósito
  var btnSelect = $("btnSelectDepositImage");
  if (btnSelect) {
    btnSelect.addEventListener("click", async function() {
      try {
        var res = await window.api.configSelectDepositImage();
        if (res?.ok) {
          showAlert("📷 Imagen de depósito configurada: " + res.name, "success");
          loadDepositImage();
        }
      } catch (err) {
        showAlert("❌ Error seleccionando imagen: " + err.message, "error");
      }
    });
  }

  var btnRemove = $("btnRemoveDepositImage");
  if (btnRemove) {
    btnRemove.addEventListener("click", async function() {
      if (!confirm("¿Quitar la imagen de depósito?")) return;
      try {
        var res = await window.api.configRemoveDepositImage();
        if (res?.ok) {
          showAlert("🗑️ Imagen de depósito eliminada", "success");
          loadDepositImage();
        }
      } catch (err) {
        showAlert("❌ Error eliminando imagen: " + err.message, "error");
      }
    });
  }
});