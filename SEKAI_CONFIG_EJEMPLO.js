/**
 * 🎵 Configuración de Sekai Music Server
 * 
 * Archivo: public/runtime-config.js (en tu proyecto Sekai)
 * 
 * INSTRUCCIONES:
 * 1. Reemplaza 'TU-DOMINIO' con tu URL real de Render
 * 2. Guarda el archivo
 * 3. Recarga Sekai en el navegador
 * 
 * Ejemplo real:
 * window.SEKAI_MUSIC_SERVER = 'https://sekai-music-server-abc123.onrender.com';
 */

// ============================================================================
// MÚSICA SERVER - URL DE RENDER
// ============================================================================

// ANTES (reemplaza esto)
// window.SEKAI_MUSIC_SERVER = 'http://localhost:8787';

// DESPUÉS (usa tu URL real de Render)
window.SEKAI_MUSIC_SERVER = 'https://TU-DOMINIO.onrender.com';

// Ejemplo con dominio personalizado:
// window.SEKAI_MUSIC_SERVER = 'https://musica.tudominio.com';

// ============================================================================
// CONFIGURACIÓN AVANZADA (opcional)
// ============================================================================

// Timeout para requests (en ms)
window.SEKAI_MUSIC_TIMEOUT = 30000;

// Reintentos automáticos si el servidor está dormido (plan free)
window.SEKAI_MUSIC_RETRIES = 3;

// Caché local del catálogo (opcional)
window.SEKAI_CACHE_CATALOG = true;
window.SEKAI_CACHE_DURATION = 3600000; // 1 hora en ms

// ============================================================================
// CÓMO OBTENER TU URL DE RENDER
// ============================================================================

/*
1. Accede a tu dashboard en: https://render.com/dashboard
2. Busca "sekai-music-server"
3. Click en el servicio
4. En la esquina superior, verás algo como:
   
   sekai-music-server-xxxx.onrender.com
   
5. Copia esa URL y úsala aquí:
   
   window.SEKAI_MUSIC_SERVER = 'https://sekai-music-server-xxxx.onrender.com';
*/

// ============================================================================
// ENDPOINTS DISPONIBLES
// ============================================================================

/*
Tu servidor de música expone estos endpoints:

GET  /health
     Retorna: { ok: true, service: "sekai-music-server", tracks: N }
     Uso: verificar que el servidor está vivo

GET  /api/catalog
     Retorna: { source: "...", total: N, data: [...] }
     Uso: obtener lista de todas las canciones

POST /api/upload (multipart/form-data)
     Fields: song (file), cover (file, opcional), title, artist, album, year
     Retorna: { ok: true, track: {...}, total: N }
     Uso: subir nueva canción desde la interfaz web

DELETE /api/tracks/:id
     Retorna: { ok: true, total: N }
     Uso: eliminar una canción

GET  /api/lyrics?artist=X&title=Y
     Retorna: { source: "lrclib", artist: "...", title: "...", lyrics: "...", synced: null }
     Uso: obtener lyrics (consultando LRCLIB automáticamente)

*/

// ============================================================================
// TROUBLESHOOTING
// ============================================================================

/*
PROBLEMA: "Error al conectar"
SOLUCIÓN: 
- Verifica que Render haya terminado el deployment (>5 min)
- Abre https://tu-url.onrender.com/health en el navegador
- Si dice "Cannot GET", el deployment falló en Render

PROBLEMA: "Primer request muy lento"
SOLUCIÓN:
- Es normal: el plan free entra en sleep cada 15 min
- Primer request despierta el servidor (~30s)
- Los siguientes son instantáneos
- Upgrade a plan Starter para evitarlo ($7/mes)

PROBLEMA: "Canciones desaparecen después de reinicio"
SOLUCIÓN:
- Verifica que render.yaml tenga configurado el disk (debería estar)
- Los archivos se guardan en /opt/render/project/src/data
- Si los pierdes, revisa los logs en Render dashboard

PROBLEMA: "Lyrics no funcionan"
SOLUCIÓN:
- El servidor consulta LRCLIB (servicio externo)
- Si LRCLIB está down, no habrá lyrics
- Espera o intenta con otro artist/title

*/

// ============================================================================
// VERIFICAR QUE FUNCIONA
// ============================================================================

console.log('🎵 Sekai Music Server configurado en:', window.SEKAI_MUSIC_SERVER);

// En la consola del navegador (F12), ejecuta:
// fetch(window.SEKAI_MUSIC_SERVER + '/health').then(r => r.json()).then(console.log)
// Deberías ver: { ok: true, service: "sekai-music-server", tracks: 0 }

