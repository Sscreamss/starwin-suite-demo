# 🤖 BotDash - WhatsApp Bot Manager

<p align="center">
  <img src="https://img.shields.io/badge/Electron-28.0.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/WhatsApp-Bot-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp">
  <img src="https://img.shields.io/badge/Google%20Sheets-Integration-34A853?style=for-the-badge&logo=googlesheets&logoColor=white" alt="Google Sheets">
</p>

Panel de control para gestionar múltiples líneas de WhatsApp con bot automatizado, creación de usuarios y registro en Google Sheets.

---

## ✨ Características

- 📱 **Multi-línea**: Gestiona hasta 30 líneas de WhatsApp simultáneamente
- 🤖 **Bot automatizado**: Respuestas automáticas 24/7
- 👤 **Creación de usuarios**: Registro automático en plataforma externa
- 💰 **Flujo de depósitos**: Gestión de pagos con envío de datos bancarios
- 📊 **Dashboard**: Estadísticas en tiempo real con gráficos
- 📝 **Google Sheets**: Registro automático de usuarios creados
- ⚙️ **Editor de mensajes**: Personaliza todos los textos sin tocar código
- 🔄 **Cloudflare Bypass**: Manejo automático de protección CF

---

## 📋 Requisitos

- **Node.js** 18 o superior
- **Google Chrome** o **Microsoft Edge** instalado
- **Windows** 10/11 (64-bit)
- Credenciales de **Google Service Account** (para Sheets)

---

## 🚀 Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/botdash.git
cd botdash
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar credenciales

#### Google Sheets

1. Crear un proyecto en [Google Cloud Console](https://console.cloud.google.com/)
2. Habilitar la API de Google Sheets
3. Crear una Service Account y descargar el JSON
4. Colocar el archivo en `credentials/google-credentials.json`
5. Configurar `config/sheets-config.json`:

```json
{
  "spreadsheetId": "TU_SPREADSHEET_ID",
  "sheetName": "Usuarios"
}
```

#### Configuración del Bot

Editar `config/bot-config.json`:

```json
{
  "url": "https://tu-plataforma.com",
  "usernameSuffix": "_sufijo",
  "fixedPassword": "Contraseña123",
  "safety": {
    "rateLimitSeconds": 2
  }
}
```

### 4. Ejecutar en desarrollo

```bash
npm start
```

---

## 🏗️ Compilar para Producción

### Instalador Windows

```bash
npm run build
```

### Portable (sin instalación)

```bash
npm run build:portable
```

Los archivos se generan en la carpeta `dist/`.

---

## 📁 Estructura del Proyecto

```
botdash/
├── bot/
│   ├── engine.js          # Lógica del bot (intents, flujos)
│   ├── configStore.js     # Gestión de configuración
│   ├── sessionStore.js    # Manejo de sesiones de usuario
│   └── sheetsLogger.js    # Integración con Google Sheets
├── whatsapp/
│   └── lineManager.js     # Gestión de líneas WhatsApp
├── cloudflare/
│   └── cfMaintainer.js    # Manejo de Cloudflare clearance
├── config/
│   ├── bot-config.json    # Configuración del bot
│   └── sheets-config.json # Config de Google Sheets
├── credentials/
│   └── google-credentials.json  # Service Account (no incluido)
├── main.js                # Proceso principal Electron
├── preload.js             # Bridge entre main y renderer
├── index.html             # Panel principal
├── config.html            # Editor de mensajes
├── dashboard.html         # Estadísticas
├── app.js                 # Lógica del frontend
└── styles.css             # Estilos de la UI
```

---

## 🎮 Uso

### Panel Principal

- **Estado del Sistema**: Ver líneas activas, mensajes del día, usuarios creados
- **Lista de Líneas**: Iniciar/detener líneas, escanear QR
- **Consola**: Ver logs en tiempo real de cada línea

### Comandos del Bot

Los usuarios de WhatsApp pueden usar:

| Comando | Acción |
|---------|--------|
| `INFORMACION` | Muestra información de la plataforma |
| `CREAR USUARIO` | Inicia el registro de cuenta |
| `DEPOSITO` | Envía datos bancarios para transferencia |
| `ASISTENCIA` | Muestra contacto de soporte |
| `MENU` | Vuelve al menú principal |

### Editor de Mensajes

Accede desde el botón "Editar Mensajes" para personalizar:

- Mensaje de bienvenida
- Texto de información y soporte
- Plantilla de cuenta creada
- Datos bancarios y CBU
- Mensajes del flujo de depósito

---

## 🔧 Configuración Avanzada

### Agregar nuevas líneas

Editar `config/lines.json`:

```json
{
  "lines": [
    { "lineId": "linea01", "enabled": true },
    { "lineId": "linea02", "enabled": true },
    { "lineId": "linea03", "enabled": false }
  ]
}
```

### Cloudflare Clearance

Si la plataforma usa Cloudflare, el bot incluye un sistema de renovación automática:

- **Renovar CF**: Abre un navegador para resolver el captcha manualmente
- **Auto Renew**: Intenta renovar automáticamente cuando detecta expiración

---

## 📊 Google Sheets

La planilla se llena automáticamente con:

| Nombre | Teléfono | Usuario | Contraseña | Fecha | Línea | Depositó |
|--------|----------|---------|------------|-------|-------|----------|
| Juan Pérez | 5491112345678 | juanperez_starwin | Hola1234 | 31/01/2026 15:30 | linea01 | SÍ |

---

## 🐛 Solución de Problemas

### Error "Chrome/Edge no encontrado"

El bot necesita Chrome o Edge instalado. Verifica que esté en una de estas rutas:
- `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
- `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

### Línea en estado ERROR

1. Haz clic en "Detener" y luego "Iniciar"
2. Si pide QR, escanéalo desde WhatsApp
3. Si persiste, usa "Renovar CF"

### No se guardan usuarios en Sheets

1. Verifica que `google-credentials.json` sea válido
2. Asegúrate de compartir la planilla con el email del Service Account
3. Revisa que `spreadsheetId` sea correcto en `sheets-config.json`

---

## 🛠️ Tecnologías

- **[Electron](https://www.electronjs.org/)** - Framework de aplicación desktop
- **[whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)** - Cliente de WhatsApp Web
- **[Puppeteer](https://pptr.dev/)** - Control de navegador
- **[Google APIs](https://github.com/googleapis/google-api-nodejs-client)** - Integración con Sheets
- **[Chart.js](https://www.chartjs.org/)** - Gráficos del dashboard

---

## 📄 Licencia

Este proyecto es de uso privado. Todos los derechos reservados.

---

## 👤 Autor

**Martin Kroh**

---