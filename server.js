/**
 * ============================================================
 * SEKAI MUSIC SERVER - Versión Profesional / Enterprise
 * - Soporte Supabase + Almacenamiento Local
 * - Fallback Inteligente SoundCloud -> YouTube (Invidious)
 * - Cola con Doble Prioridad (Alta: App Search / Baja: AutoScraper)
 * - Filtro estricto <= 60s + Etiquetado ID3 (.mp3)
 * - Búsqueda Tolerante a Errores (Fuzzy Search con Fuse.js)
 * - Integración de Letras de Canciones (LRCLIB API)
 * - Normalización de Audio y Conversión mediante FFmpeg
 * - Paginación, Filtros y Ordenamiento en /api/catalog
 * - Cobertura de Covers Animados (GIF / Apple Music)
 * - Limpieza Automática de Duplicados (Protegiendo is_manual: true)
 * - Métrica de Reproducciones y Dashboard de Control
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
const musicMetadata = require('music-metadata');
const nodeID3 = require('node-id3');
const Fuse = require('fuse.js');
const ffmpeg = require('fluent-ffmpeg');

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

const NOTIFICATION_EMAIL = 'lunethos.dev@gmail.com';
let downloadedInLastInterval = [];

// Lista de Artistas Ampliada (Incluye late night drive home, Eve y recomendaciones)
const SEED_ARTISTS = [
  'late night drive home', 'Eve', 'Grupo Frontera', 'Laufey', "Her's", 
  'Depresión Sonora', 'Bad Bunny', 'Peso Pluma', 'YOASOBI', 'Ado', 
  'Taylor Swift', 'Billie Eilish', 'Feid', 'Karol G', 'The Neighbourhood', 
  'Wallows', 'TV Girl', 'Cuco', 'Fujii Kaze', 'Kenshi Yonezu', 'Tatsuro Yamashita'
];

const SEED_GENRES = ['regional mexicano', 'indie rock', 'city pop', 'latin pop', 'post punk', 'j-pop', 'indie pop'];

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendCompletionEmail(totalTracks) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  const mailOptions = {
    from: `"Sekai Music Server" <${process.env.EMAIL_USER}>`,
    to: NOTIFICATION_EMAIL,
    subject: '🎉 ¡Proceso de Descarga Finalizado!',
    html: `
      <h2>¡Hola!</h2>
      <p>El servidor de música <strong>Sekai</strong> ha completado la cola de descargas.</p>
      <ul>
        <li><strong>Estado:</strong> Completado / Cola Vacía</li>
        <li><strong>Total de canciones en catálogo:</strong> ${totalTracks}</li>
        <li><strong>Fecha/Hora:</strong> ${new Date().toLocaleString('es-ES')}</li>
      </ul>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Correo enviado a ${NOTIFICATION_EMAIL}`);
  } catch (err) {
    console.error('[Email] Error enviando correo:', err.message);
  }
}

async function sendIntervalReportEmail() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  if (downloadedInLastInterval.length === 0) return;

  const currentList = [...downloadedInLastInterval];
  downloadedInLastInterval = [];

  const listHtml = currentList.map(t => `<li><strong>${t.artist}</strong> - ${t.title}</li>`).join('');

  const mailOptions = {
    from: `"Sekai Music Server" <${process.env.EMAIL_USER}>`,
    to: NOTIFICATION_EMAIL,
    subject: `📥 Reporte: ${currentList.length} canciones descargadas en 10 min`,
    html: `
      <h2>Avance de Descargas (Últimos 10 Minutos)</h2>
      <ul>${listHtml}</ul>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error('[Email] Error enviando reporte:', err.message);
  }
}

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
  } catch (err) {}

  const key = crypto.randomBytes(32).toString('hex');

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      API_KEY_FILE,
      JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 }
    );
  } catch (err) {}

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
// CREAR CARPETAS
// ============================================================

for (const directory of [MUSIC_DIR, COVERS_DIR]) {
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (err) {}
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
  } catch (err) {}
}

function findCoverExt(title) {
  const base = slug(title);
  for (const extension of ['gif', 'jpg', 'jpeg', 'png', 'webp']) {
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

async function getAudioDuration(filePath) {
  try {
    const metadata = await musicMetadata.parseFile(filePath);
    return metadata.format.duration || 0;
  } catch (err) {
    return 0;
  }
}

// ============================================================
// NORMALIZACIÓN DE AUDIO & ETIQUETADO ID3
// ============================================================

function normalizeAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilter('loudnorm=I=-16:TP=-1.5:LRA=11')
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .on('end', () => resolve(true))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

function embedID3Tags(filePath, { title, artist, album, year, imageBuffer }) {
  const tags = {
    title: title,
    artist: artist,
    album: album || 'Sekai Music',
    year: year || new Date().getFullYear().toString(),
    image: imageBuffer ? {
      mime: 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Cover',
      imageBuffer: imageBuffer
    } : undefined
  };
  nodeID3.write(tags, filePath);
}

// ============================================================
// SERVICIO DE LETRAS (LRCLIB)
// ============================================================

async function fetchLyrics(artist, title) {
  try {
    const res = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      plainLyrics: data.plainLyrics || null,
      syncedLyrics: data.syncedLyrics || null
    };
  } catch (err) {
    return null;
  }
}

// ============================================================
// CATÁLOGO Y FUSE.JS (FUZZY SEARCH)
// ============================================================

let fuseInstance = null;

function updateFuseIndex(data) {
  fuseInstance = new Fuse(data, {
    keys: ['title', 'artist', 'album'],
    threshold: 0.4
  });
}

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
      duration: previous.duration || null,
      plays: previous.plays || 0,
      lyrics: previous.lyrics || null,
      is_manual: Boolean(previous.is_manual)
    };
  });

  writeCatalog(catalogData);
  updateFuseIndex(catalogData);
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
    duration: row.duration || null,
    plays: row.plays || 0,
    lyrics: row.lyrics || null,
    is_manual: Boolean(row.is_manual)
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
      updateFuseIndex(catalog);
      return catalog;
    } catch (error) {
      console.error('Error leyendo Supabase:', error.message);
    }
  }
  catalog = scanCatalog();
  return catalog;
}

// ============================================================
// COVERS (iTunes / Apple Music)
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

    if (best.artistId) {
      const animatedUrl = `https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/animated-cover.gif`; 
      const testAnim = await fetch(animatedUrl, { method: 'HEAD' });
      if (testAnim.ok) return { url: animatedUrl, ext: 'gif', isAnimated: true };
    }

    let artwork = best.artworkUrl100 || best.artworkUrl60 || null;
    if (artwork) {
      artwork = artwork.replace('100x100bb', '600x600bb').replace('60x60bb', '600x600bb');
      return { url: artwork, ext: 'jpg', isAnimated: false };
    }
    return null;
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
// LIMPIEZA DE DUPLICADOS Y PISTAS CORTAS
// ============================================================

async function cleanDuplicatesAndShortTracks() {
  console.log('[Clean-System] Ejecutando limpieza de catálogo...');
  await refreshCatalog();

  const seen = new Map();
  const toDelete = [];

  for (const track of catalog) {
    if (track.duration && Number(track.duration) <= 60 && !track.is_manual) {
      toDelete.push(track);
      continue;
    }

    const key = `${slug(track.artist)}-${slug(track.title)}`;
    if (seen.has(key)) {
      const existingTrack = seen.get(key);
      if (track.is_manual && !existingTrack.is_manual) {
        toDelete.push(existingTrack);
        seen.set(key, track);
      } else {
        toDelete.push(track);
      }
    } else {
      seen.set(key, track);
    }
  }

  for (const track of toDelete) {
    console.log(`[Clean-System] Eliminando pista inválida/duplicada: "${track.artist} - ${track.title}" (${track.duration || 'N/A'}s)`);
    try {
      if (useSupabase) {
        await supabase.storage.from(SUPABASE_BUCKET).remove([`music/${track.fileName}`, ...(track.coverFile ? [`covers/${track.coverFile}`] : [])]);
        await supabase.from('music_tracks').delete().eq('id', track.id);
      } else {
        const musicPath = path.join(MUSIC_DIR, track.fileName);
        if (fs.existsSync(musicPath)) fs.unlinkSync(musicPath);
        if (track.coverFile) {
          const coverPath = path.join(COVERS_DIR, track.coverFile);
          if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
        }
      }
    } catch (err) {
      console.error(`[Clean-System] Error eliminando ${track.id}:`, err.message);
    }
  }

  await refreshCatalog();
  console.log(`[Clean-System] Limpieza finalizada. ${toDelete.length} elementos eliminados.`);
  return toDelete.length;
}

setInterval(cleanDuplicatesAndShortTracks, 6 * 60 * 60 * 1000);

// ============================================================
// COLA CON DOBLE PRIORIDAD
// ============================================================

const highPriorityQueue = [];
const lowPriorityQueue = [];
let isDownloading = false;
let completionTimer = null;
let activeProcess = false;

function checkQueueCompletion() {
  const totalQueueSize = highPriorityQueue.length + lowPriorityQueue.length;
  if (totalQueueSize === 0 && !isDownloading && activeProcess) {
    console.log('[Queue] La cola está vacía. Esperando confirmación...');
    clearTimeout(completionTimer);
    
    completionTimer = setTimeout(async () => {
      if (highPriorityQueue.length === 0 && lowPriorityQueue.length === 0 && !isDownloading && activeProcess) {
        activeProcess = false;
        console.log('[Queue] Proceso concluido. Ejecutando limpieza y notificando...');
        await cleanDuplicatesAndShortTracks();
        await refreshCatalog();
        await sendIntervalReportEmail();
        await sendCompletionEmail(catalog.length);
      }
    }, 3 * 60 * 1000);
  }
}

async function processQueue() {
  if (isDownloading) return;

  const task = highPriorityQueue.shift() || lowPriorityQueue.shift();

  if (!task) {
    checkQueueCompletion();
    return;
  }

  isDownloading = true;
  activeProcess = true;
  clearTimeout(completionTimer);

  try {
    const remaining = highPriorityQueue.length + lowPriorityQueue.length;
    console.log(`[Queue] Descargando: "${task.searchQuery}" (${remaining} restantes)`);
    const result = await executeScrape(task);
    if (task.resolve) task.resolve(result);
  } catch (err) {
    if (task.reject) task.reject(err);
  } finally {
    isDownloading = false;
    setTimeout(processQueue, 2000);
  }
}

async function executeScrape({ searchQuery, reqArtist, reqTitle, album, year, is_manual }) {
  const rawFilename = `raw-${Date.now()}`;
  const rawFilePath = path.join(DATA_DIR, `${rawFilename}.mp3`);
  const tempFilename = `norm-${Date.now()}`;
  const tempFilePath = path.join(DATA_DIR, `${tempFilename}.mp3`);

  const dlpOptions = {
    extractAudio: true,
    audioFormat: 'mp3',
    output: rawFilePath,
    noCheckCertificates: true,
    noWarnings: true,
    concurrentFragments: 1,
    limitRate: '1M'
  };

  let downloadSuccess = false;
  let sourceUsed = 'SoundCloud';

  try {
    await ytDlp(`scsearch1:${searchQuery}`, dlpOptions);
    if (fs.existsSync(rawFilePath)) {
      const dur = await getAudioDuration(rawFilePath);
      if (dur > 60) {
        downloadSuccess = true;
      } else {
        try { fs.unlinkSync(rawFilePath); } catch (_) {}
      }
    }
  } catch (err) {
    if (fs.existsSync(rawFilePath)) try { fs.unlinkSync(rawFilePath); } catch (_) {}
  }

  if (!downloadSuccess) {
    try {
      sourceUsed = 'YouTube';
      await ytDlp(`ytsearch1:${searchQuery}`, dlpOptions);
      if (fs.existsSync(rawFilePath)) {
        const dur = await getAudioDuration(rawFilePath);
        if (dur > 60) {
          downloadSuccess = true;
        } else {
          try { fs.unlinkSync(rawFilePath); } catch (_) {}
          throw new Error('El audio encontrado es una pista corta <= 60s.');
        }
      }
    } catch (err) {
      if (fs.existsSync(rawFilePath)) try { fs.unlinkSync(rawFilePath); } catch (_) {}
      throw new Error(`Falló la descarga en SoundCloud y YouTube: ${err.message}`);
    }
  }

  try {
    // Normalización de Audio con FFmpeg
    try {
      await normalizeAudio(rawFilePath, tempFilePath);
      fs.unlinkSync(rawFilePath);
    } catch (normErr) {
      fs.renameSync(rawFilePath, tempFilePath);
    }

    const durationSecs = Math.round(await getAudioDuration(tempFilePath));
    const parsed = parseFilename(searchQuery);
    const title = reqTitle || parsed.title;
    const artist = reqArtist || parsed.artist;
    const id = generateTrackId();
    const songName = `${Date.now()}-${slug(title)}.mp3`;

    let coverBuffer = null;
    let coverName = null;
    const coverInfo = await searchCoverFromItunes(artist, title);

    if (coverInfo) {
      const downloaded = await downloadImage(coverInfo.url);
      if (downloaded) {
        coverBuffer = downloaded;
        coverName = `${Date.now()}-${slug(title || artist)}.${coverInfo.ext}`;
      }
    }

    // Incrustar etiquetas ID3
    embedID3Tags(tempFilePath, {
      title,
      artist,
      album,
      year,
      imageBuffer: coverBuffer
    });

    const lyricsData = await fetchLyrics(artist, title);
    const songBuffer = fs.readFileSync(tempFilePath);
    try { fs.unlinkSync(tempFilePath); } catch (_) {}

    downloadedInLastInterval.push({ artist, title });

    if (useSupabase) {
      const songPath = `music/${songName}`;
      let uploadResult = await supabase.storage.from(SUPABASE_BUCKET).upload(songPath, songBuffer, { contentType: 'audio/mpeg', upsert: false });
      if (uploadResult.error) throw uploadResult.error;

      if (coverBuffer && coverName) {
        const mime = coverName.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
        uploadResult = await supabase.storage.from(SUPABASE_BUCKET).upload(`covers/${coverName}`, coverBuffer, { contentType: mime, upsert: false });
        if (uploadResult.error) {
          await supabase.storage.from(SUPABASE_BUCKET).remove([songPath]);
          throw uploadResult.error;
        }
      }

      const row = {
        id, title, artist, album, year,
        file_name: songName, cover_file: coverName, duration: durationSecs,
        file_url: publicStorageUrl('music', songName),
        cover_url: coverName ? publicStorageUrl('covers', coverName) : null,
        plays: 0,
        lyrics: lyricsData,
        is_manual: Boolean(is_manual)
      };

      const insertResult = await supabase.from('music_tracks').insert(row).select().single();
      if (insertResult.error) throw insertResult.error;

      await refreshCatalog();
      return { ok: true, source: sourceUsed, track: convertSupabaseTrack(insertResult.data), total: catalog.length };
    }

    fs.writeFileSync(path.join(MUSIC_DIR, songName), songBuffer);
    if (coverBuffer && coverName) fs.writeFileSync(path.join(COVERS_DIR, coverName), coverBuffer);

    const track = {
      id, title, artist, album, year,
      fileName: songName,
      file: localUrl('music', songName),
      cover: coverName ? localUrl('covers', coverName) : null,
      coverFile: coverName,
      duration: durationSecs,
      plays: 0,
      lyrics: lyricsData,
      is_manual: Boolean(is_manual)
    };

    catalog.push(track);
    writeCatalog(catalog);
    updateFuseIndex(catalog);

    return { ok: true, source: sourceUsed, track, total: catalog.length };
  } catch (err) {
    if (fs.existsSync(tempFilePath)) try { fs.unlinkSync(tempFilePath); } catch (_) {}
    if (fs.existsSync(rawFilePath)) try { fs.unlinkSync(rawFilePath); } catch (_) {}
    throw err;
  }
}

// ============================================================
// AUTO-SCRAPE INTELIGENTE
// ============================================================

function addToQueueIfMissing(artist, title) {
  const exists = catalog.some(c => 
    c.title.toLowerCase().includes(title.toLowerCase()) && 
    c.artist.toLowerCase().includes(artist.toLowerCase())
  );

  if (!exists) {
    lowPriorityQueue.push({
      searchQuery: `${artist} ${title}`,
      reqArtist: artist,
      reqTitle: title,
      album: '',
      year: '',
      is_manual: false
    });
  }
}

async function autoScrapeTrendsAndArtists() {
  console.log('[Auto-System] Iniciando rastreo por tendencias y artistas...');
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('es', { month: 'long' });

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

  console.log(`[Auto-System] ${lowPriorityQueue.length} canciones añadidas a la cola.`);
  processQueue();
}

// ============================================================
// MULTER
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
    highQueueSize: highPriorityQueue.length,
    lowQueueSize: lowPriorityQueue.length,
    uptime: process.uptime()
  });
});

app.post('/api/clean', requireApiKey, async (_req, res, next) => {
  try {
    const cleanedCount = await cleanDuplicatesAndShortTracks();
    res.json({ ok: true, removedTracks: cleanedCount, totalRemaining: catalog.length });
  } catch (err) {
    next(err);
  }
});

app.get('/api/search', requireApiKey, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Falta parámetro de búsqueda' });

  await refreshCatalog();

  // Búsqueda Flexible / Fuzzy
  let matches = [];
  if (fuseInstance) {
    const fuseResults = fuseInstance.search(q);
    matches = fuseResults.map(r => r.item);
  }

  if (matches.length > 0) {
    return res.json({ source: 'catalog', data: matches });
  }

  console.log(`[App Search] Petición prioritarias recibida: "${q}".`);

  const task = { searchQuery: q, reqArtist: '', reqTitle: q, album: '', year: '', is_manual: false };
  const downloadPromise = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });

  highPriorityQueue.push(task);
  processQueue();

  try {
    const result = await downloadPromise;
    return res.json({ source: 'downloaded_now', data: [result.track] });
  } catch (err) {
    return res.status(500).json({ error: 'Error al descargar la canción requerida', details: err.message });
  }
});

app.get('/api/catalog', requireApiKey, async (req, res) => {
  await refreshCatalog();

  let page = parseInt(req.query.page) || 1;
  let limit = parseInt(req.query.limit) || 50;
  let sort = req.query.sort || 'latest';

  let data = [...catalog];

  if (sort === 'popular') {
    data.sort((a, b) => (b.plays || 0) - (a.plays || 0));
  } else if (sort === 'artist') {
    data.sort((a, b) => a.artist.localeCompare(b.artist));
  } else if (sort === 'title') {
    data.sort((a, b) => a.title.localeCompare(b.title));
  }

  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedData = data.slice(startIndex, endIndex);

  res.json({
    source: 'sekai-music-server',
    storage: useSupabase ? 'supabase' : 'local',
    total: catalog.length,
    page,
    totalPages: Math.ceil(catalog.length / limit),
    data: paginatedData
  });
});

app.post('/api/tracks/:id/play', requireApiKey, async (req, res) => {
  const trackId = String(req.params.id);
  const track = catalog.find(t => String(t.id) === trackId);

  if (!track) return res.status(404).json({ error: 'Canción no encontrada' });

  track.plays = (track.plays || 0) + 1;

  if (useSupabase) {
    await supabase.from('music_tracks').update({ plays: track.plays }).eq('id', track.id);
  } else {
    writeCatalog(catalog);
  }

  res.json({ ok: true, plays: track.plays });
});

app.get('/api/tracks/:id/lyrics', requireApiKey, async (req, res) => {
  const trackId = String(req.params.id);
  const track = catalog.find(t => String(t.id) === trackId);

  if (!track) return res.status(404).json({ error: 'Canción no encontrada' });

  if (track.lyrics) {
    return res.json({ ok: true, lyrics: track.lyrics });
  }

  const fetched = await fetchLyrics(track.artist, track.title);
  if (fetched) {
    track.lyrics = fetched;
    if (useSupabase) {
      await supabase.from('music_tracks').update({ lyrics: fetched }).eq('id', track.id);
    } else {
      writeCatalog(catalog);
    }
    return res.json({ ok: true, lyrics: fetched });
  }

  res.status(404).json({ error: 'Letras no encontradas' });
});

app.post('/api/scrape', requireApiKey, (req, res, next) => {
  const query = String(req.body.query || req.body.search || '').trim();
  const reqArtist = String(req.body.artist || '').trim();
  const reqTitle = String(req.body.title || '').trim();
  const searchQuery = query || `${reqArtist} ${reqTitle}`.trim();

  if (!searchQuery) {
    return res.status(400).json({ error: 'Se requiere término de búsqueda' });
  }

  const task = { 
    searchQuery, 
    reqArtist, 
    reqTitle, 
    album: String(req.body.album || '').trim(), 
    year: String(req.body.year || '').trim(),
    is_manual: Boolean(req.body.is_manual)
  };
  
  const downloadPromise = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });

  highPriorityQueue.push(task);
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
    updateFuseIndex(catalog);
    return res.json({ ok: true, total: catalog.length });
  } catch (error) {
    next(error);
  }
});

app.get('/', (_req, res) => {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    res.type('html').send(html.replace('', `<script>window.SEKAI_API_KEY=${JSON.stringify(API_KEY)};</script>`));
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
  await cleanDuplicatesAndShortTracks();
  startKeepAlive();
  autoScrapeTrendsAndArtists();
});

