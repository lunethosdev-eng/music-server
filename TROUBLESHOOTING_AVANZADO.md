# 🔧 Troubleshooting Avanzado: Sekai Music Server

## 1. Problemas de Deploy

### "Build failed" en Render
**Síntomas**: Red "X" en dashboard, no sube nada

**Causas posibles**:
- Node version incompatible
- Error en `package.json`
- Falta `render.yaml`

**Soluciones**:
1. Verifica `package.json` es válido (online JSON validator)
2. Revisa logs en Render → "Logs" → "Build"
3. Comprueba que `render.yaml` existe en raíz
4. Si todo falla: elimina `node_modules`, comitea limpio

```bash
rm -rf node_modules
npm install
git add package-lock.json
git commit -m "Update lock file"
git push
```

---

### "Deployment failed" (rojo parpadeante)
**Síntomas**: Build OK pero servicio no inicia

**Causas posibles**:
- Puerto no es 8080 (Render espera ese)
- Error en `server.js`
- Directorio de datos no existe

**Soluciones**:
1. Verifica `server.js` línea 7:
   ```javascript
   const PORT = process.env.PORT || 8787;  // ← Debería ser 8080 en Render
   ```
2. En Render.yaml, comprueba:
   ```yaml
   envVars:
     - key: PORT
       value: 8080  # ← IMPORTANTE
   ```
3. Lee los logs: Dashboard → "Logs"

---

### El servidor inicia pero no responde
**Síntomas**: Health check timeout, "Cannot GET /"

**Causas posibles**:
- CORS mal configurado
- Ruta raíz `/` mal definida
- Problema de red de Render

**Soluciones**:
1. Verifica `server.js` línea 16-17:
   ```javascript
   app.use(cors());  // ← Debe estar habilitado
   app.get('/', (_req,res)=>res.sendFile(path.join(ROOT,'index.html')));
   ```
2. Prueba health check:
   ```bash
   curl https://tu-url.onrender.com/health
   ```
3. Si sigue fallando, reinicia el servicio:
   - Dashboard → Servidor → "Logs" → "Restart" (arriba a la derecha)

---

## 2. Problemas de Almacenamiento

### "Archivos desaparecen después de redeploy"
**Síntomas**: Subes canciones, hace redeploy, desaparecen

**Causa**: Almacenamiento efímero (olvidaste volumen persistente)

**Solución**: Verifica `render.yaml` tiene:
```yaml
disk:
  name: music-data
  mountPath: /opt/render/project/src/data
  sizeGB: 10
```

Si no está, agrega y haz push. **Nota**: Una vez agregado, no puedes cambiar el tamaño fácilmente.

---

### "Disco lleno" (upload falla)
**Síntomas**: Upload exitoso pero archivo no aparece, error vago

**Causa**: Alcanzaste 10GB en Render free

**Soluciones**:
1. Obtén espacio usado:
   ```bash
   # En los logs, busca el tamaño de music/
   du -sh /opt/render/project/src/data/*
   ```

2. Opción A: Elimina canciones no usadas
   - Via interfaz web → botón delete
   - O por API: `DELETE /api/tracks/:id`

3. Opción B: Upgrade a plan Starter
   - Render dashboard → Plan → Starter ($7/mes)
   - Mucho más espacio

4. Opción C: Migra a cloud storage
   - Adapta `server.js` para usar AWS S3 o Cloudflare R2
   - Requiere código adicional (contacta si lo necesitas)

---

## 3. Problemas de Upload

### "Upload cuelga" (tarda eternidad)
**Síntomas**: Click upload, página sigue en loading, nunca termina

**Causas posibles**:
- Archivo muy grande
- Conexión lenta
- Timeout de Render (30 segs)

**Soluciones**:
1. Límite actual: 100MB
   - Para archivos > 100MB: error inmediato
   - Comprime MP3 a menor bitrate (128kbps está bien)

2. Aumenta timeout (SOLO si es necesario):
   - Edita `server.js` línea 18:
     ```javascript
     app.use(express.json({ limit: '2mb' }));
     app.use(express.urlencoded({ limit: '200mb', extended: true }));  // ← aumenta esto
     ```
   - Commit y push

3. Optimiza audio:
   ```bash
   ffmpeg -i cancion.mp3 -b:a 192k -y cancion-optimizada.mp3
   ```

---

### "Error 413: Payload Too Large"
**Síntoma**: Ves este error al subir

**Causa**: Archivo > 100MB o header > 2MB

**Solución**:
1. Comprueba tamaño: `ls -lh archivo.mp3`
2. Si > 100MB, comímelo localmente:
   ```bash
   ffmpeg -i grande.mp3 -b:a 192k pequeño.mp3
   ```
3. Si el error es headers (raro), necesitas aumentar límite en `server.js`

---

## 4. Problemas de Rendimiento

### "Primer request muy lento (30+ segundos)"
**Síntoma**: Primera vez que accedes → esperas mucho

**Causa**: Plan FREE → Render pone servidor a dormir cada 15 min

**Soluciones**:

A. **Aceptar el comportamiento** (gratis):
   - Solo ocurre si no hay tráfico 15 min
   - Planifica que usuarios esperen al inicio

B. **Mantener despierto** (gratis pero requiere mantenimiento):
   - Crea un cron job que ping cada 10 min
   - O usa UptimeRobot (gratis, https://uptimerobot.com)
   - Configura para hacer GET a `/health` cada 10 min

C. **Upgrade a Starter** ($7/mes):
   - Sin spin-down
   - Mejor performance general
   - Vale la pena si tienes muchos usuarios

**Implementar UptimeRobot (gratis)**:
1. Ve a https://uptimerobot.com
2. Sign up gratis
3. "Add Monitor" → HTTP(s)
4. URL: `https://tu-url.onrender.com/health`
5. Interval: 10 minutos
6. Guardar

Ahora el servidor nunca duerme.

---

### "Reproducción de audio entrecortada"
**Síntoma**: Archivo suena bien localmente pero cortado en servidor

**Causas posibles**:
- Bitrate muy bajo del MP3
- Ancho de banda de Render limitado
- Conexión del usuario lenta

**Soluciones**:
1. Verifica bitrate local:
   ```bash
   ffprobe -v error -select_streams a:0 -show_entries stream=bit_rate -of default=noprint_wrappers=1:nokey=1:nokey=1 archivo.mp3
   ```
   Debería ser ≥ 128kbps

2. Si < 128kbps, re-encoda:
   ```bash
   ffmpeg -i cancion.mp3 -b:a 192k cancion-fix.mp3
   ```

3. Si persiste, es límite de ancho de banda de Render
   - Upgrade a plan Starter
   - O comprime más: `-b:a 96k` (sacrifica calidad)

---

## 5. Problemas de Integración con Sekai

### "Sekai no carga canciones"
**Síntoma**: En Sekai, lista vacía aunque subiste canciones

**Causa**: URL mal configurada o servidor no responde

**Debug**:
1. Verifica configuración Sekai:
   ```javascript
   console.log(window.SEKAI_MUSIC_SERVER);
   ```
   Debería mostrar tu URL completa

2. Prueba el endpoint manualmente:
   ```javascript
   fetch(window.SEKAI_MUSIC_SERVER + '/api/catalog')
     .then(r => r.json())
     .then(console.log);
   ```
   Debería mostrar tus canciones

3. Si sale error CORS:
   - Verifica que `cors()` está activo en `server.js`
   - Render debería permitirlo por defecto

---

### "Lyrics no cargan"
**Síntoma**: `GET /api/lyrics?...` retorna error 404

**Causas posibles**:
- LRCLIB no tiene la canción
- Parámetros artist/title incorrectos
- LRCLIB está offline

**Soluciones**:
1. Verifica que artist y title existen en LRCLIB:
   - Ve a https://lrclib.net
   - Busca manualmente la canción
   - Si no existe, no hay lyrics

2. Parámetros deben coincidir exactamente:
   ```
   /api/lyrics?artist=The%20Beatles&title=Let%20It%20Be
   ```
   (espacios como %20)

3. Si LRCLIB está down (raro), espera o intenta más tarde

---

## 6. Problemas de Red

### "CORS error en navegador"
**Síntoma**: Ves error similar a "Access-Control-Allow-Origin"

**Causa**: CORS no configurado correctamente

**Solución** (en `server.js`, línea 16):
```javascript
const cors = require('cors');
app.use(cors());  // ← Debe estar ANTES de las rutas
```

Si lo editaste, commit y push:
```bash
git add server.js
git commit -m "Fix CORS"
git push
```

Render redeploy automático en 1-2 min.

---

### "Timeout al conectar a Sekai"
**Síntoma**: Sekai dice "Error connecting to music server"

**Causas posibles**:
- Servidor en spin-down (30 seg espera es normal)
- Firewall/proxy bloqueando
- URL incorrecta

**Soluciones**:
1. Espera 30 segs si es primer request
2. Verifica URL en browser:
   ```
   https://tu-url.onrender.com/health
   ```
   Si funciona, es un problema de Sekai config

3. Revisa console Sekai (F12) para errores exactos

---

## 7. Optimizaciones

### Reducir tiempo de spin-down
**Meta**: Mantener servidor despierto sin upgrade

**Método 1**: UptimeRobot (recomendado)
- Ya descrito arriba
- Gratuito
- Confiable

**Método 2**: Cron job propio
```bash
# Cada 9 minutos, haz GET a health
# En tu servidor personal o Cron.io (gratuito)
curl https://tu-url.onrender.com/health
```

**Método 3**: Upgrade a Starter
- $7/mes
- Sin spin-down
- 2x veces el almacenamiento

---

### Comprimir canciones para ahorrar espacio
```bash
# Música normal → 128kbps (buena calidad)
ffmpeg -i cancion.mp3 -b:a 128k cancion-128.mp3

# Muy comprimido → 96kbps (aceptable)
ffmpeg -i cancion.mp3 -b:a 96k cancion-96.mp3

# Verificar tamaño antes/después
ls -lh cancion.mp3 cancion-128.mp3
```

Típicamente 128kbps = 1MB/minuto

---

### Usar Cloudflare R2 para almacenamiento ilimitado
**Si alcanzas 10GB**, migra a R2:

1. Crea cuenta Cloudflare (gratis)
2. R2 → Crear bucket
3. Adapta `server.js` para usar SDK de AWS:
   ```javascript
   const AWS = require('aws-sdk');
   const s3 = new AWS.S3({
     endpoint: 'https://your-account.r2.cloudflarestorage.com',
     accessKeyId: process.env.R2_ACCESS_KEY,
     secretAccessKey: process.env.R2_SECRET_KEY,
   });
   ```
4. Env vars en Render dashboard
5. Comitea cambios

**Costo R2**: ~$0.015/GB (muy barato para uso personal)

Si necesitas ayuda con esto, contacta.

---

## 8. Debug Checklist

Antes de pedir help:

- [ ] Revisé los logs en Render dashboard
- [ ] Probé `/health` manualmente en navegador
- [ ] Verificación que `render.yaml` existe
- [ ] Comité y hice push de cambios (Render no redeploy automáticamente si no pusheó)
- [ ] Esperé 5 minutos después de push para deployment
- [ ] Limpié cache browser (Ctrl+F5)
- [ ] Probé en incógnito/privado
- [ ] Verifiqué URL sin typos
- [ ] Checkee tamaño de archivos

---

## 9. Logs útiles

**Ver logs en Render**:
1. Dashboard → sekai-music-server
2. "Logs" pestaña (arriba)
3. Filtrar por "stderr" para errores

**Búsquedas útiles en logs**:
- `error` → errores
- `ENOENT` → archivo no encontrado
- `ENOSPC` → disco lleno
- `PORT` → problema de puerto
- `CORS` → problema de CORS

**Copiar log completo**:
- Click el botón "Download" en la esquina

---

## 10. Contacto y más ayuda

Si nada funciona:

1. **GitHub Issues**: Si crees que es un bug del código
2. **Render Support**: https://support.render.com (responden en 1-2 horas)
3. **Discord de Render**: https://discord.gg/render (comunidad activa)
4. **StackOverflow**: Tag con `render`, `express`, `node.js`

**Información útil al pedir help**:
- URL del servidor
- Logs exactos (paste de Render)
- Pasos para reproducir el problema
- Tu sistema operativo

---

**¡Suerte con tu servidor!** 🎵
