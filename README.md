# 🎵 Sekai Music Server

Servidor Express para el catálogo musical de Sekai con interfaz de upload, lyrics y API REST.

## ✨ Características

- **Interfaz web** en `/` para subir canciones y covers
- **API REST** completa para gestionar canciones
- **Lyrics automáticas** via LRCLIB
- **Almacenamiento persistente** en Render (10GB)
- **CORS habilitado** para integraciones
- **Soporte de formatos**: MP3, M4A, WAV, OGG, FLAC

## 🚀 Deploy en Render (Recomendado)

### Opción 1: Deploy automático desde GitHub
1. Sube este código a GitHub
2. Ve a https://render.com
3. Conecta tu repositorio
4. Render detectará `render.yaml` automáticamente
5. Click "Create Web Service"
6. ¡Listo! Tu servidor estará en vivo en ~5 minutos

### Opción 2: Deploy manual
```bash
# Localmente
npm install
npm start
# Abre http://localhost:8080
```

## 🔌 API Endpoints

```
GET  /health                                  # Health check
GET  /api/catalog                             # Obtener catálogo completo
GET  /catalog.json                            # Catálogo (formato alternativo)
POST /api/upload                              # Subir canción + cover
POST /api/rescan                              # Rescannear archivos
DELETE /api/tracks/:id                        # Eliminar canción
GET  /api/lyrics?artist=X&title=Y             # Obtener lyrics (LRCLIB)
```

## 🎯 Conectar con Sekai

En tu proyecto Sekai, en `public/runtime-config.js`:

```javascript
window.SEKAI_MUSIC_SERVER = 'https://tu-render-url.onrender.com';
```

Ejemplo real:
```javascript
window.SEKAI_MUSIC_SERVER = 'https://sekai-music-server-abc123.onrender.com';
```

## 📁 Estructura

```
.
├── server.js              # Servidor (no modificar)
├── index.html             # Interfaz web
├── package.json           # Dependencias
├── render.yaml            # Config para Render
├── music/                 # Almacén de canciones
├── covers/                # Almacén de covers
└── catalog.json           # Generado automáticamente
```

## ⚙️ Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | 8080 | Puerto del servidor |
| `NODE_ENV` | production | Entorno |
| `DATA_DIR` | `./` | Ruta base para archivos |
| `MUSIC_DIR` | `./music` | Carpeta de canciones |
| `COVERS_DIR` | `./covers` | Carpeta de covers |

En Render, `DATA_DIR` apunta automáticamente al volumen persistente.

## 💾 Almacenamiento

- **Render Free**: 10GB persistente (suficiente para ~500-1000 canciones MP3)
- **Render Starter**: $7/mes, sin limitaciones de spin-down
- **Upgrade a cloud storage**: Adapta el código para AWS S3 o Cloudflare R2

## ⚠️ Limitaciones del plan FREE

1. **Spin-down**: 15 min sin tráfico → 30s para despertar
2. **Almacenamiento**: 10GB máximo
3. **Ancho de banda**: Limitado pero suficiente para uso personal
4. **Uptime**: No garantizado

## 🔧 Desarrollo local

```bash
npm install
npm start
```

Luego abre:
- Interfaz: http://localhost:8080
- API: http://localhost:8080/api/catalog
- Health: http://localhost:8080/health

## 🤝 Soporte

- Logs en Render → Dashboard → "Logs"
- Revisar `server.js` para detalles técnicos
- API LRCLIB: https://lrclib.net

## 📝 Licencia

MIT - Libre para usar y modificar

---

**Deploy hecho por**: Yyyy  
**Tecnología**: Node.js + Express  
**Almacenamiento**: Render Disk (10GB)
