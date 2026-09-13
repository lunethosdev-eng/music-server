# 🚀 Guía COMPLETA: Deploy Sekai Music Server en Render

## Paso 0: Requisitos
- Cuenta en **GitHub** (gratis)
- Cuenta en **Render.io** (gratis)
- Tu código local (ya lo tienes)

---

## Paso 1: Preparar GitHub

### 1.1 Crear repositorio en GitHub
1. Ve a https://github.com/new
2. Nombre del repo: `sekai-music-server`
3. Privado o público (tu elección)
4. **NO** inicialices con README (lo haremos local)
5. Click "Create repository"

### 1.2 Subir tu código

En tu terminal, desde el directorio del proyecto:

```bash
# Inicializar git (si no lo has hecho)
git init

# Agregar todos los archivos
git add .

# Primer commit
git commit -m "Initial commit: Sekai Music Server"

# Agregar el remote (reemplaza TU-USUARIO)
git remote add origin https://github.com/TU-USUARIO/sekai-music-server.git

# Cambiar rama a main
git branch -M main

# Subir a GitHub
git push -u origin main
```

**Verifica en GitHub que tu código esté allí.**

---

## Paso 2: Configurar Render

### 2.1 Acceder a Render
1. Ve a https://render.com
2. Click "Sign up" (o "Sign in" si tienes cuenta)
3. Conecta tu cuenta de GitHub

### 2.2 Crear nuevo servicio
1. En el dashboard de Render, click **"New +"**
2. Selecciona **"Web Service"**
3. Busca tu repositorio `sekai-music-server`
4. Selecciona y click "Connect"

### 2.3 Configurar el servicio

**En la pantalla de creación del servicio:**

```
Name: sekai-music-server
Environment: Node
Branch: main
Build Command: npm install
Start Command: npm start
Instance Type: Free
```

Scroll down → **"Advanced"** y verifica:
- ✅ Auto-deploy: encendido

Click **"Create Web Service"**

---

## Paso 3: Esperar deployment

Render leerá automáticamente `render.yaml` y configurará:
- **Disk (volumen persistente)**: 10GB para almacenar canciones
- **Environment variables**: `DATA_DIR=/opt/render/project/src/data`

Esto toma **2-5 minutos**. Verás algo como:
```
✓ Build successful
✓ Deployment successful
```

Tu URL será algo como:
```
https://sekai-music-server-xxxx.onrender.com
```

---

## Paso 4: Verificar que funciona

### 4.1 Health check
Abre en el navegador:
```
https://sekai-music-server-xxxx.onrender.com/health
```

Deberías ver:
```json
{"ok": true, "service": "sekai-music-server", "tracks": 0}
```

### 4.2 Acceder a la interfaz
```
https://sekai-music-server-xxxx.onrender.com/
```

Deberías ver el formulario para subir canciones.

---

## Paso 5: Conectar con Sekai

En tu proyecto Sekai, en `public/runtime-config.js`:

```javascript
window.SEKAI_MUSIC_SERVER = 'https://sekai-music-server-xxxx.onrender.com';
```

Reemplaza `xxxx` con tu dominio real de Render.

---

## Paso 6: Usar el servidor

### Subir una canción
1. Abre https://sekai-music-server-xxxx.onrender.com/
2. Llena los campos:
   - **Song**: archivo `.mp3`, `.m4a`, `.wav`, `.ogg`, `.flac` (máx 100MB)
   - **Cover** (opcional): imagen JPG/PNG/WEBP
3. Click **"Upload"**

### API endpoints
```
GET  /health                              # Health check
GET  /api/catalog                         # Obtener todas las canciones
GET  /catalog.json                        # Idem (formato alternativo)
POST /api/upload                          # Subir canción + cover
POST /api/rescan                          # Rescannear carpeta de música
DELETE /api/tracks/:id                    # Eliminar canción
GET  /api/lyrics?artist=...&title=...     # Obtener lyrics (LRCLIB)
```

---

## Limitaciones del plan FREE de Render

⚠️ **Importante:**

1. **Spin-down**: Si no hay tráfico por 15 minutos, el servidor se duerme
   - Primera solicitud tardará 30 segundos en despertar
   - Solución: ping cada 10 min (o upgrade a plan pagado)

2. **Almacenamiento persistente**: Incluido 10GB (suficiente para ~500-1000 canciones)

3. **Ancho de banda**: Limitado pero razonable para uso personal

4. **Uptime**: No está garantizado (mejora con plan pagado)

---

## Upgrades y troubleshooting

### Si necesitas reducir spin-down
Opción A: Upgrade a plan **Starter** ($7/mes)
- Sin spin-down
- Mejor performance

Opción B: Crear un cron job que haga ping cada 10 minutos
- Requiere configuración adicional

### Si se agotan los 10GB
Adapta el código para usar **Cloudflare R2** (cloud storage):
- Más barato que AWS S3
- Integración sencilla
- Free tier: primeros 10GB/mes

### Logs en Render
En el dashboard de Render → "Logs" verás todos los errores y actividad.

---

## Archivos clave en tu proyecto

```
sekai-music-server/
├── server.js           # Servidor Express (no toques)
├── index.html          # Interfaz web (no toques)
├── package.json        # Dependencias (no toques)
├── render.yaml         # ⭐ Config para Render (no toques)
├── music/              # Carpeta donde se guardan canciones
├── covers/             # Carpeta donde se guardan covers
└── catalog.json        # Generado automáticamente
```

---

## Duda frecuente: "¿Dónde está mi dominio personalizado?"

Si quieres un dominio como `musica.ejemplo.com`:
1. Compra un dominio (GoDaddy, Namecheap, etc.)
2. En Render → "Settings" → "Custom Domain"
3. Configura DNS del dominio a Render
4. Espera 24h para propagación

**Costo**: solo el dominio (~$10-15/año)

---

## Resumen de URLs

| Uso | URL |
|-----|-----|
| Interfaz web | `https://sekai-music-server-xxxx.onrender.com/` |
| API Catalog | `https://sekai-music-server-xxxx.onrender.com/api/catalog` |
| Health check | `https://sekai-music-server-xxxx.onrender.com/health` |
| Config Sekai | `window.SEKAI_MUSIC_SERVER = 'https://sekai-music-server-xxxx.onrender.com'` |

---

## ¿Necesitas help?

- Logs en Render → Dashboard → "Logs"
- Revisión de código → `server.js` (está bien documentado)
- Problemas de DNS → espera 24h o contacta Render support

¡Listo! Tu servidor de música está en el cloud 🎵
