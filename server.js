/**
 * ============================================================
 *  SEKAI MUSIC SERVER
 *  Versión completa con Notificaciones por Correo + Auto-Scraper
 *  - Soporte Supabase + Local
 *  - Descarga bajo demanda en tiempo real desde Apps (/api/search)
 *  - Auto-descarga de Artistas Famosos (2023-2026) y Tendencias
 *  - Reporte acumulativo por Correo cada 10 minutos
 *  - Notificación automática por Email al finalizar la cola
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const ytDlp = require('youtube-dl-exec');
const nodemailer = require('nodemailer');

// ============================================================
// CONFIGURACIÓN BÁSICA Y CORREO
// ============================================================

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;

const DATA_DIR = process.env.DATA_DIR || ROOT;
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(DATA_DIR, 'music');
const COVERS_DIR = process.env.COVERS_DIR || path.join(DATA_DIR, 'covers');
const CATALOG_FILE = process.env.CATALOG_FILE || path.join(DATA_DIR, 'catalog.json');
const API_KEY_FILE = path.join(DATA_DIR, 'api-key.json');

// Configuración del correo destino
const NOTIFICATION_EMAIL = 'lunethos.dev@gmail.com';

// Arreglo para acumular descargas y enviar reporte cada 10 minutos
let downloadedInLastInterval = [];

// Artistas semilla iniciales
const SEED_ARTISTS = [
  'Grupo Frontera',
  'Laufey',
  'Her\'s',
  'Depresión Sonora',
  'Bad Bunny',
  'Peso Pluma',
  'YOASOBI',
  'Ado',
  'Taylor Swift',
  'Billie Eilish',
  'Feid',
  'Karol G'
];

const SEED_GENRES = ['regional mexicano', 'indie rock', 'city pop', 'latin pop', 'post punk'];

// Transportador de correo
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendCompletionEmail(totalTracks) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[Email] No se enviará correo: Faltan las variables EMAIL_USER o EMAIL_PASS');
    return;
  }

  const mailOptions = {
    from: `"Sekai Music Server" <${process.env.EMAIL_USER}>`,
    to: NOTIFICATION_EMAIL,
    subject: '🎉 ¡Proceso de Descarga Finalizado!',
    html: `
      <h2>¡Hola!</h2>
      <p>El servidor de música <strong>Sekai</strong> ha completado la cola de descargas automáticas.</p>
      <ul>
        <li><strong>Estado:</strong> Completado / Cola Vacía</li>
        <li><strong>Total de canciones en el catálogo:</strong> ${totalTracks}</li>
        <li><strong>Fecha/Hora:</strong> ${new Date().toLocaleString('es-ES')}</li>
      </ul>
      <p>Todas las canciones ya están disponibles en tu catálogo y base de datos.</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Correo de notificación enviado a ${NOTIFICATION_EMAIL}`);
  } catch (err) {
    console.error('[Email] Error enviando correo de finalización:', err.message);
  }
}

// Función para enviar el reporte de canciones descargadas cada 10 minutos
async function sendIntervalReportEmail() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  if (downloadedInLastInterval.length === 0) return;

  const currentList = [...downloadedInLastInterval];
  downloadedInLastInterval = []; // Limpiar lista para los siguientes 10 min

  const listHtml = currentList.map(t => `<li><strong>${t.artist}</strong> - ${t.title}</li>`).join('');

  const mailOptions = {
    from: `"Sekai Music Server" <${process.env.EMAIL_USER}>`,
    to: NOTIFICATION_EMAIL,
    subject: `📥 Reporte: ${currentList.length} canciones descargadas en los últimos 10 min`,
    html: `
      <h2>Avance de Descargas (Últimos 10 Minutos)</h2>
      <p>Se han descargado y procesado con éxito las siguientes <strong>${currentList.length}</strong> canciones:</p>
      <ul>
        ${listHtml}
      </ul>
      <p><em>Servidor activo en progreso...</em></p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Reporte de 10 minutos enviado con ${currentList.length} canciones.`);
  } catch (err) {
    console.error('[Email] Error enviando reporte periódico:', err.message);
  }
}

// Iniciar temporizador del reporte cada 10 minutos (600,000 ms)
setInterval(sendIntervalReportEmail, 10 * 60 * 1000);

// ============================================================
// SUPABASE
// ============================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_BUCKET = (process.env.SUPABASE_BUCKET || 'music').trim();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        realtime: { transport: ws }
      })
    : null;

const useSupabase = Boolean(supabase);

// ============================================================
// API KEY
// ============================================================

function getOrCreateApiKey() {
  if (process.env.API_KEY && process.env.API_KEY.trim()) {
    return process.env.API_KEY.trim();
  }

  try {
    if (fs.existsSync(API_KEY_FILE)) {
      const saved = JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf8'));
      if (saved && typeof saved.key === 'string' && saved.key.length >= 32) {
        return saved.key;
      }
    }
  } catch (err) {
    console.warn('No se pudo leer api-key.json:', err.message);
  }

  const key = crypto.randomBytes(32).toString('hex');

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      API_KEY_FILE,
      JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 }
    );
  } catch (err) {
    console.error('No se pudo guardar la API Key:', err.message);
  }

  console.log('API KEY generada:', key);
  return key;
}

const API_KEY = getOrCreateApiKey();

function requireApiKey(req, res, next) {
  const supplied = req.get('x-api-key') || req.query.api_key || '';
  if (!supplied || supplied !== API_KEY) {
    return res.status(401).json({ error: 'API key inválida o faltante' });
  }
  next();
}

// ============================================================
// CREAR CARPETAS NECESARIAS
// ============================================================

for (const directory of [MUSIC_DIR, COVERS_DIR]) {
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (err) {
    console.error(`No se pudo crear la carpeta ${directory}:`, err.message);
  }
}

// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/music', requireApiKey, express.static(MUSIC_DIR, { acceptRanges: true }));
app.use('/covers', requireApiKey, express.static(COVERS_DIR));

// ============================================================
// UTILIDADES
// ============================================================

function cleanName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/[^\p{L}\p{N}._ ()\-]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseFilename(name) {
  const base = name.replace(/\.(mp3|m4a|wav|ogg|flac)$/i, '');
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: 'Unknown', title: base };
}

function readCatalog() {
  try {
    const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeCatalog(catalogData) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalogData, null, 2));
  } catch (err) {
    console.error('Error escribiendo catalog.json:', err.message);
  }
}

function findCoverExt(title) {
  const base = slug(title);
  for (const extension of ['jpg', 'jpeg', 'png', 'webp']) {
    if (fs.existsSync(path.join(COVERS_DIR, `${base}.${extension}`))) return extension;
  }
  return null;
}

function localUrl(folder, filename) {
  return `/${folder}/${encodeURIComponent(filename)}?api_key=${encodeURIComponent(API_KEY)}`;
}

function publicStorageUrl(folder, filename) {
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${folder}/${encodeURIComponent(filename)}`;
}

function generateTrackId() {
  return `sekai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// CATÁLOGO LOCAL Y SUPABASE
// ============================================================

function scanCatalog() {
  const oldCatalog = readCatalog();
  const byFile = Object.fromEntries(oldCatalog.map(track => [track.fileName, track]));

  let files = [];
  try {
    files = fs.readdirSync(MUSIC_DIR).filter(file => /\.(mp3|m4a|wav|ogg|flac)$/i.test(file));
  } catch (err) {
    return [];
  }

  const catalogData = files.map((fileName, index) => {
    const previous = byFile[fileName] || {};
    const parsed = parseFilename(fileName);
    const id = previous.id || `sekai-${Date.now()}-${index}`;
    const coverName = previous.coverFile || `${slug(previous.title || parsed.title)}.${findCoverExt(previous.title || parsed.title) || 'jpg'}`;
    const coverExists = coverName && fs.existsSync(path.join(COVERS_DIR, coverName));

    return {
      id,
      title: previous.title || parsed.title,
      artist: previous.artist || parsed.artist,
      album: previous.album || '',
      year: previous.year || '',
      fileName,
      file: localUrl('music', fileName),
      cover: coverExists ? localUrl('covers', coverName) : previous.cover || null,
      coverFile: coverExists ? coverName : previous.coverFile || null,
      duration: previous.duration || null
    };
  });

  writeCatalog(catalogData);
  return catalogData;
}

let catalog = scanCatalog();

function convertSupabaseTrack(row) {
  const fileName = row.file_name || row.fileName || row.filename || null;
  const coverFile = row.cover_file || row.coverFile || null;

  return {
    id: String(row.id),
    title: row.title || '',
    artist: row.artist || '',
    album: row.album || '',
    year: row.year || '',
    fileName,
    file: row.file_url || (fileName ? publicStorageUrl('music', fileName) : null),
    cover: row.cover_url || (coverFile ? publicStorageUrl('covers', coverFile) : null),
    coverFile,
    duration: row.duration || null
  };
}

async function getRemoteCatalog() {
  const result = await supabase.from('music_tracks').select('*').order('created_at', { ascending: true });
  if (result.error) throw result.error;
  return (result.data || []).map(convertSupabaseTrack);
}

async function refreshCatalog() {
  if (useSupabase) {
    try {
      catalog = await getRemoteCatalog();
      return catalog;
    } catch (error) {
      console.error('Error leyendo Supabase:', error.message);
    }
  }
  catalog = scanCatalog();
  return catalog;
}

// ============================================================
// BÚSQUEDA DE COVERS (iTunes)
// ============================================================

async function searchCoverFromItunes(artist, title) {
  if (!artist && !title) return null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const response = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=5`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;
    const best = data.results.find(item => item.artworkUrl100 || item.artworkUrl60);
    if (!best) return null;
    let artwork = best.artworkUrl100 || best.artworkUrl60 || null;
    return artwork ? artwork.replace('100x100bb', '600x600bb').replace('60x60bb', '600x600bb') : null;
  } catch (err) {
    return null;
  }
}

async function downloadImage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    return null;
  }
}

// ============================================================
// COLA DE DESCARGAS Y DETECTOR DE FINALIZACIÓN
// ============================================================

const downloadQueue = [];
let isDownloading = false;
let completionTimer = null;
let activeProcess = false;

function checkQueueCompletion() {
  if (downloadQueue.length === 0 && !isDownloading && activeProcess) {
    console.log('[Queue] La cola está vacía. Esperando confirmación...');
    clearTimeout(completionTimer);
    
    completionTimer = setTimeout(async () => {
      if (downloadQueue.length === 0 && !isDownloading && activeProcess) {
        activeProcess = false;
        console.log('[Queue] Proceso concluido. Enviando correo final...');
        await refreshCatalog();
        await sendIntervalReportEmail(); // Enviar remanente de descargas
        await sendCompletionEmail(catalog.length);
      }
    }, 3 * 60 * 1000);
  }
}

async function processQueue() {
  if (isDownloading || downloadQueue.length === 0) {
    checkQueueCompletion();
    return;
  }

  isDownloading = true;
  activeProcess = true;
  clearTimeout(completionTimer);

  const task = downloadQueue.shift();

  try {
    console.log(`[Queue] Descargando: "${task.searchQuery}" (${downloadQueue.length} restantes)`);
    const result = await executeScrape(task);
    if (task.resolve) task.resolve(result);
  } catch (err) {
    if (task.reject) task.reject(err);
  } finally {
    isDownloading = false;
    setTimeout(processQueue, 2500); // Pausa recomendada para Render
  }
}

async function executeScrape({ searchQuery, reqArtist, reqTitle, album, year }) {
  const tempFilename = `scrape-${Date.now()}`;
  const tempFilePath = path.join(DATA_DIR, `${tempFilename}.mp3`);

  try {
    const dlpOptions = {
      extractAudio: true,
      audioFormat: 'mp3',
      output: tempFilePath,
      noCheckCertificates: true,
      noWarnings: true,
      concurrentFragments: 1,
      limitRate: '1M'
    };

    await ytDlp(`scsearch1:${searchQuery}`, dlpOptions);

    if (!fs.existsSync(tempFilePath)) {
      throw new Error('No se generó el archivo de audio');
    }

    const songBuffer = fs.readFileSync(tempFilePath);
    try { fs.unlinkSync(tempFilePath); } catch (_) {}

    const parsed = parseFilename(searchQuery);
    const title = reqTitle || parsed.title;
    const artist = reqArtist || parsed.artist;
    const id = generateTrackId();
    const songName = `${Date.now()}-${slug(title)}.mp3`;

    let coverBuffer = null;
    let coverName = null;
    const coverUrl = await searchCoverFromItunes(artist, title);

    if (coverUrl) {
      const downloaded = await downloadImage(coverUrl);
      if (downloaded) {
        coverBuffer = downloaded;
        coverName = `${Date.now()}-${slug(title || artist)}.jpg`;
      }
    }

    // Registrar descarga para el reporte de 10 min
    downloadedInLastInterval.push({ artist, title });

    if (useSupabase) {
      const songPath = `music/${songName}`;
      let uploadResult = await supabase.storage.from(SUPABASE_BUCKET).upload(songPath, songBuffer, { contentType: 'audio/mpeg', upsert: false });
      if (uploadResult.error) throw uploadResult.error;

      if (coverBuffer && coverName) {
        uploadResult = await supabase.storage.from(SUPABASE_BUCKET).upload(`covers/${coverName}`, coverBuffer, { contentType: 'image/jpeg', upsert: false });
        if (uploadResult.error) {
          await supabase.storage.from(SUPABASE_BUCKET).remove([songPath]);
          throw uploadResult.error;
        }
      }

      const row = {
        id, title, artist, album, year,
        file_name: songName, cover_file: coverName, duration: null,
        file_url: publicStorageUrl('music', songName),
        cover_url: coverName ? publicStorageUrl('covers', coverName) : null
      };

      const insertResult = await supabase.from('music_tracks').insert(row).select().single();
      if (insertResult.error) throw insertResult.error;

      await refreshCatalog();
      return { ok: true, track: convertSupabaseTrack(insertResult.data), total: catalog.length };
    }

    fs.writeFileSync(path.join(MUSIC_DIR, songName), songBuffer);
    if (coverBuffer && coverName) fs.writeFileSync(path.join(COVERS_DIR, coverName), coverBuffer);

    const track = { id, title, artist, album, year, fileName: songName, file: localUrl('music', songName), cover: coverName ? localUrl('covers', coverName) : null, coverFile: coverName, duration: null };
    catalog.push(track);
    writeCatalog(catalog);

    return { ok: true, track, total: catalog.length };
  } catch (err) {
    if (fs.existsSync(tempFilePath)) try { fs.unlinkSync(tempFilePath); } catch (_) {}
    throw err;
  }
}

// ============================================================
// AUTO-SCRAPE: TENDENCIAS, ARTISTAS (2023-2026) Y GÉNEROS
// ============================================================

function addToQueueIfMissing(artist, title) {
  const exists = catalog.some(c => 
    c.title.toLowerCase().includes(title.toLowerCase()) && 
    c.artist.toLowerCase().includes(artist.toLowerCase())
  );

  if (!exists) {
    downloadQueue.push({
      searchQuery: `${artist} ${title}`,
      reqArtist: artist,
      reqTitle: title,
      album: '',
      year: ''
    });
  }
}

async function autoScrapeTrendsAndArtists() {
  console.log('[Auto-System] Iniciando rastreo por tendencias y artistas...');
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('es', { month: 'long' });

  // 1. Obtener éxitos de Artistas Preferidos
  for (const artist of SEED_ARTISTS) {
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=song&limit=10`);
      if (res.ok) {
        const data = await res.json();
        for (const item of (data.results || [])) {
          addToQueueIfMissing(item.artistName, item.trackName);
        }
      }
    } catch (_) {}
  }

  // 2. Éxitos virales del Año y Mes
  try {
    const query = `Top Hits ${currentMonth} ${currentYear}`;
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=15`);
    if (res.ok) {
      const data = await res.json();
      for (const item of (data.results || [])) {
        addToQueueIfMissing(item.artistName, item.trackName);
      }
    }
  } catch (_) {}

  // 3. Resguardo por Géneros
  for (const genre of SEED_GENRES) {
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(genre)}&entity=song&limit=5`);
      if (res.ok) {
        const data = await res.json();
        for (const item of (data.results || [])) {
          addToQueueIfMissing(item.artistName, item.trackName);
        }
      }
    } catch (_) {}
  }

  console.log(`[Auto-System] ${downloadQueue.length} canciones añadidas a la cola de procesamiento.`);
  processQueue();
}

// ============================================================
// MULTER (UPLOAD)
// ============================================================

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ============================================================
// ENDPOINTS
// ============================================================

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'sekai-music-server',
    storage: useSupabase ? 'supabase' : 'local',
    tracks: catalog.length,
    queueSize: downloadQueue.length,
    uptime: process.uptime()
  });
});

// Endpoint de Búsqueda para Apps (Búsqueda local o Descarga Prioritaria)
app.get('/api/search', requireApiKey, async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.status(400).json({ error: 'Falta parámetro de búsqueda' });

  await refreshCatalog();

  const matches = catalog.filter(c => 
    c.title.toLowerCase().includes(q) || c.artist.toLowerCase().includes(q)
  );

  if (matches.length > 0) {
    return res.json({ source: 'catalog', data: matches });
  }

  console.log(`[App Search] Petición externa recibida: "${q}". Añadiendo al frente de la cola...`);

  const task = { searchQuery: q, reqArtist: '', reqTitle: q, album: '', year: '' };
  const downloadPromise = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });

  downloadQueue.unshift(task); // Colocar de primero para atender la app
  processQueue();

  try {
    const result = await downloadPromise;
    return res.json({ source: 'downloaded_now', data: [result.track] });
  } catch (err) {
    return res.status(500).json({ error: 'Error al descargar la canción requerida', details: err.message });
  }
});

app.get('/api/catalog', requireApiKey, async (_req, res) => {
  await refreshCatalog();
  res.json({ source: 'sekai-music-server', storage: useSupabase ? 'supabase' : 'local', total: catalog.length, data: catalog });
});

app.post('/api/scrape', requireApiKey, (req, res, next) => {
  const query = String(req.body.query || req.body.search || '').trim();
  const reqArtist = String(req.body.artist || '').trim();
  const reqTitle = String(req.body.title || '').trim();
  const searchQuery = query || `${reqArtist} ${reqTitle}`.trim();

  if (!searchQuery) {
    return res.status(400).json({ error: 'Se requiere término de búsqueda' });
  }

  const task = { searchQuery, reqArtist, reqTitle, album: String(req.body.album || '').trim(), year: String(req.body.year || '').trim() };
  const downloadPromise = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });

  downloadQueue.push(task);
  processQueue();

  downloadPromise.then(result => res.status(201).json(result)).catch(err => next(err));
});

app.delete('/api/tracks/:id', requireApiKey, async (req, res, next) => {
  try {
    const track = catalog.find(item => String(item.id) === String(req.params.id));
    if (!track) return res.status(404).json({ error: 'Canción no encontrada' });

    if (useSupabase) {
      await supabase.storage.from(SUPABASE_BUCKET).remove([`music/${track.fileName}`, ...(track.coverFile ? [`covers/${track.coverFile}`] : [])]);
      await supabase.from('music_tracks').delete().eq('id', track.id);
      await refreshCatalog();
      return res.json({ ok: true, total: catalog.length });
    }

    const index = catalog.findIndex(item => String(item.id) === String(req.params.id));
    catalog.splice(index, 1);
    writeCatalog(catalog);
    return res.json({ ok: true, total: catalog.length });
  } catch (error) {
    next(error);
  }
});

app.get('/', (_req, res) => {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    res.type('html').send(html.replace('<!-- API_KEY_INJECT -->', `<script>window.SEKAI_API_KEY=${JSON.stringify(API_KEY)};</script>`));
  } catch (err) {
    res.status(500).send('Error cargando index.html');
  }
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || 'Error en la solicitud' });
});

// ============================================================
// KEEP-ALIVE Y SERVIDOR
// ============================================================

function startKeepAlive() {
  const host = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME;
  if (!host) return;
  const pingUrl = host.startsWith('http') ? `${host}/health` : `https://${host}/health`;

  setInterval(async () => {
    try { await fetch(pingUrl); } catch (_) {}
  }, 14 * 60 * 1000);
}

app.listen(PORT, async () => {
  console.log(`Sekai Music Server corriendo en puerto ${PORT}`);
  await refreshCatalog();
  startKeepAlive();
  // Ejecutar scraper automático al iniciar
  autoScrapeTrendsAndArtists();
});

