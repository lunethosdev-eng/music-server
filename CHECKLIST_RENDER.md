# ✅ Checklist: Deploy Sekai Music Server en Render

## 📋 Pre-requisitos
- [ ] Cuenta GitHub (https://github.com/signup)
- [ ] Cuenta Render (https://render.com) - conectada con GitHub

---

## 🎯 Fase 1: Preparar tu código

### Paso 1: Organiza tu proyecto local
```
sekai-music-server/
├── server.js           ✅ (incluido)
├── index.html          ✅ (incluido)
├── package.json        ✅ (actualizado)
├── render.yaml         ✅ (optimizado)
├── Dockerfile          ✅ (nuevo - opcional)
├── .gitignore          ✅ (nuevo)
├── README.md           ✅ (actualizado)
├── music/              (carpeta para canciones)
└── covers/             (carpeta para covers)
```

### Paso 2: Inicializa Git
```bash
cd sekai-music-server
git init
git add .
git commit -m "Initial commit: Sekai Music Server"
```

✅ **Checklist**:
- [ ] Carpeta `.git` existe
- [ ] `git log` muestra al menos 1 commit

---

## 🚀 Fase 2: Subir a GitHub

### Paso 3: Crear repositorio
1. Ve a https://github.com/new
2. Nombre: `sekai-music-server`
3. Tipo: Public o Private (tu elección)
4. NO inicialices con README/gitignore (los tienes locales)
5. Click "Create repository"

✅ **Checklist**:
- [ ] Repositorio creado
- [ ] Ves la pantalla "Quick setup"

### Paso 4: Conectar y subir
```bash
git remote add origin https://github.com/TU-USUARIO/sekai-music-server.git
git branch -M main
git push -u origin main
```

Reemplaza `TU-USUARIO` con tu nombre de GitHub.

✅ **Checklist**:
- [ ] No hay errores en la consola
- [ ] Ves tus archivos en GitHub (refresca la página)
- [ ] `git log --oneline` muestra el commit

---

## 🌐 Fase 3: Deploy en Render

### Paso 5: Conectar Render a GitHub
1. Ve a https://render.com/dashboard
2. Click "New +"
3. Selecciona "Web Service"
4. Click "Connect repository"
5. Busca `sekai-music-server` y click "Connect"

✅ **Checklist**:
- [ ] Render pregunta por configuración del servicio

### Paso 6: Configurar el servicio
**En la pantalla de creación:**

```
┌─────────────────────────────────────┐
│ Name:           sekai-music-server  │
│ Branch:         main                │
│ Root Directory: (vacío - raíz)      │
│ Runtime:        Node                │
│ Build Command:  npm install         │
│ Start Command:  npm start           │
│ Instance Type:  Free                │
└─────────────────────────────────────┘
```

✅ **Checklist**:
- [ ] Todos los campos completados
- [ ] Render detectó `render.yaml` (verás un checkmark)

### Paso 7: Deploy
Click "Create Web Service"

Espera 3-5 minutos. Verás:
```
Build started
↓
Build successful ✓
Deployment live ✓
```

✅ **Checklist**:
- [ ] Ves mensaje "live" en verde
- [ ] URL de tu servicio es visible (algo como `sekai-music-server-xxxx.onrender.com`)

---

## 🧪 Fase 4: Verificar que funciona

### Paso 8: Health check
Abre en el navegador:
```
https://sekai-music-server-xxxx.onrender.com/health
```

Deberías ver:
```json
{"ok": true, "service": "sekai-music-server", "tracks": 0}
```

✅ **Checklist**:
- [ ] Ves el JSON de health
- [ ] `"ok": true` está presente
- [ ] El servicio está "live" en el dashboard de Render

### Paso 9: Interfaz web
Abre:
```
https://sekai-music-server-xxxx.onrender.com/
```

Deberías ver:
- Campo de entrada para "Song"
- Campo opcional para "Cover"
- Campos: Artist, Title, Album, Year
- Botón "Upload"

✅ **Checklist**:
- [ ] Se carga la página sin errores
- [ ] Ves el formulario

### Paso 10: Probar upload
1. Descarga un archivo MP3 pequeño de prueba
2. Sube a través de la interfaz
3. Deberías ver "Upload successful"
4. Vuelve a cargar `/` - tu canción aparecerá

✅ **Checklist**:
- [ ] Upload exitoso sin errores
- [ ] La canción aparece en el formulario

---

## 🎵 Fase 5: Conectar con Sekai

### Paso 11: Configurar Sekai
En tu proyecto Sekai, abre `public/runtime-config.js` y agrega:

```javascript
window.SEKAI_MUSIC_SERVER = 'https://sekai-music-server-xxxx.onrender.com';
```

Reemplaza `xxxx` con tu dominio real.

✅ **Checklist**:
- [ ] Archivo guardado
- [ ] URL está correcta (sin errores tipográficos)
- [ ] No hay comentarios que afecten el código

### Paso 12: Verificar integración
En Sekai:
1. Abre la consola (F12)
2. Ejecuta:
   ```javascript
   fetch(window.SEKAI_MUSIC_SERVER + '/api/catalog')
     .then(r => r.json())
     .then(console.log)
   ```
3. Deberías ver tu catálogo

✅ **Checklist**:
- [ ] El fetch no falla
- [ ] Ves `"total": 1` (o más si subiste varias)
- [ ] Ves el array `"data"` con tus canciones

---

## ⚠️ Fase 6: Conocer las limitaciones

### Plan FREE de Render
| Limitación | Impacto | Solución |
|-----------|--------|---------|
| **Spin-down** | Duerme después de 15 min inactivo | Primer request → 30s lento |
| **Almacenamiento** | 10GB máximo | ~500-1000 canciones MP3 |
| **Ancho de banda** | Limitado | OK para uso personal |
| **Uptime** | No garantizado | Upgrade a Starter ($7/mes) |

✅ **Checklist**:
- [ ] Entiendes que primer request tras inactividad es lento
- [ ] Tienes menos de 1000 canciones (si no, planifica upgrade)
- [ ] Aceptas que puede haber downtime ocasional

---

## 🔧 Troubleshooting rápido

| Problema | Solución |
|----------|----------|
| "Cannot GET /" | Espera 5 min, Render aún está deployando |
| "Connection refused" | Verifica URL, debe ser `https://` no `http://` |
| "Timeout al subir" | Archivo muy grande o conexión lenta |
| "Canción desaparece" | Verifica disk persistente en `render.yaml` |
| "Lyrics no salen" | LRCLIB down o track no existe |

✅ **Checklist**:
- [ ] Revisaste los logs en Render → Dashboard → "Logs"
- [ ] Esperaste suficiente tiempo si estaba deployando
- [ ] URL es correcta (https, sin typos)

---

## 📚 Recursos importantes

| Recurso | URL |
|---------|-----|
| **Dashboard Render** | https://render.com/dashboard |
| **Logs del servidor** | Render → sekai-music-server → "Logs" |
| **Health check** | https://tu-url.onrender.com/health |
| **API Catalog** | https://tu-url.onrender.com/api/catalog |
| **Documentación** | Ver `README.md` en tu repo |

---

## 🎉 ¡Listo!

Tu servidor está deployado y listo para usar. 

**Resumen de URLs que necesitas:**
```
Servidor:  https://sekai-music-server-xxxx.onrender.com
Interfaz:  https://sekai-music-server-xxxx.onrender.com/
API:       https://sekai-music-server-xxxx.onrender.com/api/catalog
Config:    window.SEKAI_MUSIC_SERVER = 'https://sekai-music-server-xxxx.onrender.com';
```

---

## 📞 Siguiente paso

Si necesitas:
- **Dominio personalizado**: Compra en GoDaddy/Namecheap, configura DNS en Render
- **Más almacenamiento**: Upgrade a plan Starter o adapta código para S3/R2
- **Mejor performance**: Upgrade a plan Starter ($7/mes) para evitar spin-down
- **Más tracks**: Configura Cloudflare R2 u otro cloud storage

¡Éxito con tu servidor de música! 🎵
