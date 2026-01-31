// config.js - Configuración visual de mensajes
let currentConfig = null;

// Cargar configuración al iniciar
async function loadConfig() {
    try {
        currentConfig = await window.api.configGet();
        populateForm();
    } catch (error) {
        showAlert('Error cargando configuración: ' + error.message, 'error');
    }
}

// Poblar formulario con datos actuales
function populateForm() {
    if (!currentConfig) return;

    // Mensajes de WhatsApp
    const welcomeMsg = currentConfig.menu?.welcome || '';
    // Extraer solo el texto de bienvenida (antes de "Responde con:")
    const welcomeText = welcomeMsg.split('\n\n')[0] || welcomeMsg.split('Responde con:')[0] || welcomeMsg;
    document.getElementById('welcomeMessage').value = welcomeText.trim();

    document.getElementById('infoMessage').value = currentConfig.info?.text || '';
    document.getElementById('supportMessage').value = currentConfig.support?.text || '';

    // Configuración de usuarios
    document.getElementById('fixedPassword').value = currentConfig.fixedPassword || '';
    document.getElementById('usernameSuffix').value = currentConfig.usernameSuffix || '';
    document.getElementById('siteUrl').value = currentConfig.url || '';

    // Mensaje de cuenta creada (sin email)
    const createdTemplate = currentConfig.createUser?.createdTemplate || '';
    document.getElementById('createdMessage').value = createdTemplate;

    // Mensajes de depósito
    document.getElementById('depositYesMessage').value = currentConfig.createUser?.depositYes || '';
    document.getElementById('depositNoMessage').value = currentConfig.createUser?.depositNo || '';

    // Actualizar contadores
    updateCharCounts();
    updatePreview();
}

// Actualizar contadores de caracteres
function updateCharCounts() {
    const fields = [
        { id: 'welcomeMessage', countId: 'welcomeCount', max: 500 },
        { id: 'infoMessage', countId: 'infoCount', max: 1000 },
        { id: 'supportMessage', countId: 'supportCount', max: 1000 },
        { id: 'createdMessage', countId: 'createdCount', max: 1000 },
        { id: 'depositYesMessage', countId: 'depositYesCount', max: 500 },
        { id: 'depositNoMessage', countId: 'depositNoCount', max: 500 }
    ];

    fields.forEach(field => {
        const input = document.getElementById(field.id);
        const counter = document.getElementById(field.countId);
        if (input && counter) {
            const length = input.value.length;
            counter.textContent = `${length} / ${field.max}`;
            counter.style.color = length > field.max * 0.9 ? '#f59e0b' : '#64748b';
        }
    });
}

// Actualizar vista previa
function updatePreview() {
    const template = document.getElementById('createdMessage').value;
    const password = document.getElementById('fixedPassword').value || 'Hola1234';
    const url = document.getElementById('siteUrl').value || 'https://admin.starwin.plus';
    const suffix = document.getElementById('usernameSuffix').value || '_starwin';

    // Crear ejemplo
    const preview = template
        .replace(/\{\{username\}\}/g, `martin4479${suffix}`)
        .replace(/\{\{password\}\}/g, password)
        .replace(/\{\{email\}\}/g, `martin4479${suffix}@admin.starwin.plus`)
        .replace(/\{\{url\}\}/g, url);

    document.getElementById('previewMessage').textContent = preview;
}

// Guardar configuración
async function saveConfig() {
    try {
        const welcomeText = document.getElementById('welcomeMessage').value.trim();
        
        // Construir el mensaje completo de bienvenida con las opciones
        const fullWelcomeMessage = `${welcomeText}\n\nResponde con: INFORMACION, CREAR USUARIO o ASISTENCIA`;

        const updates = {
            // Mensajes
            menu: {
                welcome: fullWelcomeMessage
            },
            info: {
                text: document.getElementById('infoMessage').value.trim()
            },
            support: {
                text: document.getElementById('supportMessage').value.trim()
            },
            createUser: {
                ...currentConfig.createUser,
                createdTemplate: document.getElementById('createdMessage').value.trim(),
                depositYes: document.getElementById('depositYesMessage').value.trim(),
                depositNo: document.getElementById('depositNoMessage').value.trim()
            },
            // Parámetros de usuario
            fixedPassword: document.getElementById('fixedPassword').value.trim(),
            usernameSuffix: document.getElementById('usernameSuffix').value.trim(),
            url: document.getElementById('siteUrl').value.trim()
        };

        await window.api.configSet(updates);
        
        showAlert('✅ Configuración guardada exitosamente', 'success');
        
        // Recargar después de 1 segundo
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
    } catch (error) {
        showAlert('❌ Error guardando: ' + error.message, 'error');
    }
}

// Mostrar alerta
function showAlert(message, type) {
    const container = document.getElementById('alertContainer');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} show`;
    alert.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    
    container.innerHTML = '';
    container.appendChild(alert);
    
    if (type === 'success') {
        setTimeout(() => {
            alert.classList.remove('show');
        }, 3000);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();

    // Contadores de caracteres
    const textInputs = document.querySelectorAll('textarea, input[type="text"]');
    textInputs.forEach(input => {
        input.addEventListener('input', () => {
            updateCharCounts();
            if (input.id === 'createdMessage' || 
                input.id === 'fixedPassword' || 
                input.id === 'siteUrl' || 
                input.id === 'usernameSuffix') {
                updatePreview();
            }
        });
    });

    // Botón guardar
    document.getElementById('btnSave').addEventListener('click', saveConfig);

    // Botón cancelar
    document.getElementById('btnCancel').addEventListener('click', () => {
        if (confirm('¿Descartar cambios y volver al dashboard?')) {
            window.location.href = 'index.html';
        }
    });
});
