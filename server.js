/**
 * ============================================================
 *  SEKAI MUSIC SERVER
 *  Versión completa y corregida
 *  - Soporte Supabase + Local
 *  - Fix de template literals
 *  - Fix WebSocket (ws) para Node 20
 *  - Keep-alive cada 14 minutos
 *  - Búsqueda automática de covers (iTunes)
 *  - Módulo de Scraping y Descarga de Música (youtube-dl-exec + Bypass de Bot)
 *  - Mejor logging y validaciones
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

// ============================================================
// CONFIGURACIÓN BÁSICA
// ============================================================

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;

const DATA_DIR = process.env.DATA_DIR || ROOT;
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(DATA_DIR, 'music');
const COVERS_DIR = process.env.COVERS_DIR || path.join(DATA_DIR, 'covers');
const CATALOG_FILE = process.env.CATALOG_FILE || path.join(DATA_DIR, 'catalog.json');
const API_KEY_FILE = path.join(DATA_DIR, 'api-key.json');

// ============================================================
// SUPABASE
// ============================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_BUCKET = (process.env.SUPABASE_BUCKET || 'music').trim();

/**
 * Cliente de Supabase.
 * Se usa transport: ws porque Node 20 no tiene WebSocket nativo.
 */
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        realtime: {
          transport: ws
        }
      })
    : null;

const useSupabase = Boolean(supabase);

// ============================================================
// API KEY
// ============================================================

/**
 * Obtiene o crea una API Key segura.
 */
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
      JSON.stringify(
        {
          key,
          createdAt: new Date().toISOString()
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch (err) {
    console.error('No se pudo guardar la API Key:', err.message);
  }

  console.log('API KEY generada (guárdala):', key);
  return key;
}

const API_KEY = getOrCreateApiKey();

/**
 * Middleware de autenticación.
 */
function requireApiKey(req, res, next) {
  const supplied = req.get('x-api-key') || req.query.api_key || '';

  if (!supplied || supplied !== API_KEY) {
    return res.status(401).json({
      error: 'API key inválida o faltante'
    });
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

// Servir archivos locales (solo si no se usa Supabase)
app.use('/music', requireApiKey, express.static(MUSIC_DIR, { acceptRanges: true }));
app.use('/covers', requireApiKey, express.static(COVERS_DIR));

// ============================================================
// FUNCIONES DE UTILIDAD
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
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim()
    };
  }

  return {
    artist: 'Unknown',
    title: base
  };
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
    const fullPath = path.join(COVERS_DIR, `${base}.${extension}`);
    if (fs.existsSync(fullPath)) {
      return extension;
    }
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

function generateFileName(originalName) {
  return `${Date.now()}-${cleanName(originalName)}`;
}

// ============================================================
// CATÁLOGO LOCAL
// ============================================================

function scanCatalog() {
  const oldCatalog = readCatalog();
  const byFile = Object.fromEntries(
    oldCatalog.map(track => [track.fileName, track])
  );

  let files = [];
  try {
    files = fs
      .readdirSync(MUSIC_DIR)
      .filter(file => /\.(mp3|m4a|wav|ogg|flac)$/i.test(file));
  } catch (err) {
    console.error('Error leyendo carpeta de música:', err.message);
    return [];
  }

  const catalogData = files.map((fileName, index) => {
    const previous = byFile[fileName] || {};
    const parsed = parseFilename(fileName);

    const id = previous.id || `sekai-${Date.now()}-${index}`;

    const coverName =
      previous.coverFile ||
      `${slug(previous.title || parsed.title)}.${findCoverExt(previous.title || parsed.title) || 'jpg'}`;

    const coverExists =
      coverName && fs.existsSync(path.join(COVERS_DIR, coverName));

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

// ============================================================
// CATÁLOGO SUPABASE
// ============================================================

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
  const result = await supabase
    .from('music_tracks')
    .select('*')
    .order('created_at', { ascending: true });

  if (result.error) {
    throw result.error;
  }

  return (result.data || []).map(convertSupabaseTrack);
}

async function refreshCatalog() {
  if (useSupabase) {
    try {
      catalog = await getRemoteCatalog();
      return catalog;
    } catch (error) {
      console.error('Error leyendo catálogo de Supabase:', error.message);
    }
  }

  catalog = scanCatalog();
  return catalog;
}

// ============================================================
// BÚSQUEDA AUTOMÁTICA DE COVERS (iTunes)
// ============================================================

async function searchCoverFromItunes(artist, title) {
  if (!artist && !title) return null;

  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const url = `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=5`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SekaiMusicServer/1.0'
      }
    });

    if (!response.ok) return null;

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return null;
    }

    const best = data.results.find(item =>
      item.artworkUrl100 || item.artworkUrl60
    );

    if (!best) return null;

    let artwork = best.artworkUrl100 || best.artworkUrl60 || null;

    if (artwork) {
      artwork = artwork.replace('100x100bb', '600x600bb').replace('60x60bb', '600x600bb');
    }

    return artwork;
  } catch (err) {
    console.warn('Error buscando cover en iTunes:', err.message);
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
    console.warn('Error descargando imagen:', err.message);
    return null;
  }
}

// ============================================================
// MULTER (UPLOAD)
// ============================================================

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100 MB
  },
  fileFilter: (_req, file, callback) => {
    if (file.fieldname === 'song') {
      if (!/\.(mp3|m4a|wav|ogg|flac)$/i.test(file.originalname)) {
        return callback(new Error('Formato de canción no permitido'));
      }
    }

    if (file.fieldname === 'cover') {
      if (!/^image\/(jpeg|png|webp)$/i.test(file.mimetype)) {
        return callback(new Error('La cover debe ser JPG, PNG o WEBP'));
      }
    }

    callback(null, true);
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'sekai-music-server',
    storage: useSupabase ? 'supabase' : 'local',
    tracks: catalog.length,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// ENDPOINTS DE CATÁLOGO
// ============================================================

app.get('/api/catalog', requireApiKey, async (_req, res) => {
  await refreshCatalog();

  res.json({
    source: 'sekai-music-server',
    storage: useSupabase ? 'supabase' : 'local',
    total: catalog.length,
    data: catalog
  });
});

app.get('/catalog.json', requireApiKey, async (_req, res) => {
  await refreshCatalog();
  res.json(catalog);
});

app.post('/api/rescan', requireApiKey, async (_req, res) => {
  await refreshCatalog();

  res.json({
    ok: true,
    total: catalog.length,
    data: catalog
  });
});

// ============================================================
// SUBIR CANCIÓN MANUALMENTE
// ============================================================

app.post(
  '/api/upload',
  requireApiKey,
  upload.fields([
    { name: 'song', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const song = req.files?.song?.[0];
      const cover = req.files?.cover?.[0];

      if (!song) {
        return res.status(400).json({
          error: 'Falta la canción'
        });
      }

      const parsed = parseFilename(song.originalname);

      const title = String(req.body.title || parsed.title).trim();
      const artist = String(req.body.artist || parsed.artist).trim();
      const album = String(req.body.album || '').trim();
      const year = String(req.body.year || '').trim();

      const id = generateTrackId();
      const songName = generateFileName(song.originalname);
      let coverName = cover ? generateFileName(cover.originalname) : null;

      let coverBuffer = cover ? cover.buffer : null;
      let coverMime = cover ? cover.mimetype : null;

      if (!coverBuffer && (artist || title)) {
        console.log(`Buscando cover automática para: ${artist} - ${title}`);
        const coverUrl = await searchCoverFromItunes(artist, title);

        if (coverUrl) {
          const downloaded = await downloadImage(coverUrl);
          if (downloaded) {
            coverBuffer = downloaded;
            coverMime = 'image/jpeg';
            coverName = `${Date.now()}-${slug(title || artist)}.jpg`;
            console.log('Cover automática encontrada y descargada');
          }
        }
      }

      if (useSupabase) {
        const songPath = `music/${songName}`;

        let uploadResult = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(songPath, song.buffer, {
            contentType: song.mimetype,
            upsert: false
          });

        if (uploadResult.error) {
          throw uploadResult.error;
        }

        if (coverBuffer && coverName) {
          uploadResult = await supabase.storage
            .from(SUPABASE_BUCKET)
            .upload(`covers/${coverName}`, coverBuffer, {
              contentType: coverMime || 'image/jpeg',
              upsert: false
            });

          if (uploadResult.error) {
            await supabase.storage.from(SUPABASE_BUCKET).remove([songPath]);
            throw uploadResult.error;
          }
        }

        const row = {
          id,
          title,
          artist,
          album,
          year,
          file_name: songName,
          cover_file: coverName,
          duration: null,
          file_url: publicStorageUrl('music', songName),
          cover_url: coverName ? publicStorageUrl('covers', coverName) : null
        };

        const insertResult = await supabase
          .from('music_tracks')
          .insert(row)
          .select()
          .single();

        if (insertResult.error) {
          await supabase.storage
            .from(SUPABASE_BUCKET)
            .remove([
              songPath,
              ...(coverName ? [`covers/${coverName}`] : [])
            ]);
          throw insertResult.error;
        }

        await refreshCatalog();

        return res.status(201).json({
          ok: true,
          track: convertSupabaseTrack(insertResult.data),
          total: catalog.length
        });
      }

      const songPath = path.join(MUSIC_DIR, songName);
      fs.writeFileSync(songPath, song.buffer);

      if (coverBuffer && coverName) {
        const coverPath = path.join(COVERS_DIR, coverName);
        fs.writeFileSync(coverPath, coverBuffer);
      }

      const track = {
        id,
        title,
        artist,
        album,
        year,
        fileName: songName,
        file: localUrl('music', songName),
        cover: coverName ? localUrl('covers', coverName) : null,
        coverFile: coverName,
        duration: null
      };

      catalog.push(track);
      writeCatalog(catalog);

      return res.status(201).json({
        ok: true,
        track,
        total: catalog.length
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// SCRAPING / EXTRACCIÓN AUTOMÁTICA DE MÚSICA (CON BYPASS BOT)
// ============================================================

app.post('/api/scrape', requireApiKey, async (req, res, next) => {
  const query = String(req.body.query || req.body.search || '').trim();
  const reqArtist = String(req.body.artist || '').trim();
  const reqTitle = String(req.body.title || '').trim();

  const searchQuery = query || `${reqArtist} ${reqTitle}`.trim();

  if (!searchQuery) {
    return res.status(400).json({
      error: 'Se requiere un término de búsqueda (query, o bien artist y title)'
    });
  }

  const tempFilename = `scrape-${Date.now()}`;
  const tempFilePath = path.join(DATA_DIR, `${tempFilename}.mp3`);

  try {
    console.log(`[Scraper] Iniciando extracción para: "${searchQuery}"`);

    // Parámetros optimizados para evadir bloqueos de bot en Render
    const dlpOptions = {
      extractAudio: true,
      audioFormat: 'mp3',
      output: tempFilePath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      extractorArgs: 'youtube:player_client=android,web',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // Si existe archivo cookies.txt en el directorio de datos, se usa automáticamente
    const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      dlpOptions.cookies = cookiesPath;
      console.log('[Scraper] Usando cookies.txt');
    }

    await ytDlp(`ytsearch1:${searchQuery}`, dlpOptions);

    if (!fs.existsSync(tempFilePath)) {
      throw new Error('No se pudo generar el archivo de audio descargado');
    }

    const songBuffer = fs.readFileSync(tempFilePath);

    try { fs.unlinkSync(tempFilePath); } catch (_) {}

    const parsed = parseFilename(searchQuery);
    const title = reqTitle || parsed.title;
    const artist = reqArtist || parsed.artist;
    const album = String(req.body.album || '').trim();
    const year = String(req.body.year || '').trim();

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

    if (useSupabase) {
      const songPath = `music/${songName}`;

      let uploadResult = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(songPath, songBuffer, {
          contentType: 'audio/mpeg',
          upsert: false
        });

      if (uploadResult.error) throw uploadResult.error;

      if (coverBuffer && coverName) {
        uploadResult = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(`covers/${coverName}`, coverBuffer, {
            contentType: 'image/jpeg',
            upsert: false
          });

        if (uploadResult.error) {
          await supabase.storage.from(SUPABASE_BUCKET).remove([songPath]);
          throw uploadResult.error;
        }
      }

      const row = {
        id,
        title,
        artist,
        album,
        year,
        file_name: songName,
        cover_file: coverName,
        duration: null,
        file_url: publicStorageUrl('music', songName),
        cover_url: coverName ? publicStorageUrl('covers', coverName) : null
      };

      const insertResult = await supabase
        .from('music_tracks')
        .insert(row)
        .select()
        .single();

      if (insertResult.error) {
        await supabase.storage
          .from(SUPABASE_BUCKET)
          .remove([songPath, ...(coverName ? [`covers/${coverName}`] : [])]);
        throw insertResult.error;
      }

      await refreshCatalog();

      return res.status(201).json({
        ok: true,
        source: 'scraped',
        track: convertSupabaseTrack(insertResult.data),
        total: catalog.length
      });
    }

    const finalSongPath = path.join(MUSIC_DIR, songName);
    fs.writeFileSync(finalSongPath, songBuffer);

    if (coverBuffer && coverName) {
      const coverPath = path.join(COVERS_DIR, coverName);
      fs.writeFileSync(coverPath, coverBuffer);
    }

    const track = {
      id,
      title,
      artist,
      album,
      year,
      fileName: songName,
      file: localUrl('music', songName),
      cover: coverName ? localUrl('covers', coverName) : null,
      coverFile: coverName,
      duration: null
    };

    catalog.push(track);
    writeCatalog(catalog);

    return res.status(201).json({
      ok: true,
      source: 'scraped',
      track,
      total: catalog.length
    });

  } catch (error) {
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (_) {}
    }
    next(error);
  }
});

// ============================================================
// ELIMINAR CANCIÓN
// ============================================================

app.delete('/api/tracks/:id', requireApiKey, async (req, res, next) => {
  try {
    const track = catalog.find(
      item => String(item.id) === String(req.params.id)
    );

    if (!track) {
      return res.status(404).json({
        error: 'Canción no encontrada'
      });
    }

    if (useSupabase) {
      const storagePaths = [
        `music/${track.fileName}`,
        ...(track.coverFile ? [`covers/${track.coverFile}`] : [])
      ];

      const removeResult = await supabase.storage
        .from(SUPABASE_BUCKET)
        .remove(storagePaths);

      if (removeResult.error) {
        console.error('Error eliminando archivos de Storage:', removeResult.error.message);
      }

      const deleteResult = await supabase
        .from('music_tracks')
        .delete()
        .eq('id', track.id);

      if (deleteResult.error) {
        throw deleteResult.error;
      }

      await refreshCatalog();

      return res.json({
        ok: true,
        total: catalog.length
      });
    }

    const index = catalog.findIndex(
      item => String(item.id) === String(req.params.id)
    );

    if (index < 0) {
      return res.status(404).json({
        error: 'Canción no encontrada'
      });
    }

    const [removedTrack] = catalog.splice(index, 1);

    const filesToDelete = [
      [removedTrack.fileName, MUSIC_DIR],
      [removedTrack.coverFile, COVERS_DIR]
    ];

    for (const [filename, directory] of filesToDelete) {
      if (!filename) continue;

      const safeFilename = path.basename(String(filename));
      const directoryPath = path.resolve(directory);
      const filePath = path.resolve(directory, safeFilename);

      if (
        filePath.startsWith(directoryPath + path.sep) &&
        fs.existsSync(filePath)
      ) {
        fs.unlinkSync(filePath);
      }
    }

    writeCatalog(catalog);

    return res.json({
      ok: true,
      total: catalog.length
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// LYRICS
// ============================================================

app.get('/api/lyrics', requireApiKey, async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();

  if (!title) {
    return res.status(400).json({
      error: 'title requerido'
    });
  }

  try {
    const query = encodeURIComponent(`${artist} ${title}`.trim());

    const response = await fetch(
      `https://lrclib.net/api/search?q=${query}`,
      {
        headers: {
          'User-Agent': 'SekaiMusicServer/1.0'
        }
      }
    );

    if (response.ok) {
      const results = await response.json();

      const best = Array.isArray(results)
        ? results.find(item => item.syncedLyrics || item.plainLyrics)
        : null;

      if (best) {
        return res.json({
          source: 'lrclib',
          artist: best.artistName || artist,
          title: best.trackName || title,
          lyrics: best.plainLyrics || '',
          synced: best.syncedLyrics || null
        });
      }
    }

    return res.status(404).json({
      error: 'No se encontraron lyrics',
      artist,
      title
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Error al buscar lyrics'
    });
  }
});

// ============================================================
// BÚSQUEDA DE COVER MANUAL
// ============================================================

app.get('/api/cover-search', requireApiKey, async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();

  if (!artist && !title) {
    return res.status(400).json({
      error: 'Se necesita al menos artist o title'
    });
  }

  const coverUrl = await searchCoverFromItunes(artist, title);

  if (!coverUrl) {
    return res.status(404).json({
      error: 'No se encontró cover',
      artist,
      title
    });
  }

  res.json({
    ok: true,
    artist,
    title,
    cover: coverUrl
  });
});

// ============================================================
// PÁGINA PRINCIPAL
// ============================================================

app.get('/', (_req, res) => {
  try {
    const indexPath = path.join(ROOT, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    const injected = html.replace(
      '<!-- API_KEY_INJECT -->',
      `<script>window.SEKAI_API_KEY=${JSON.stringify(API_KEY)};</script>`
    );

    res.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    res.type('html').send(injected);
  } catch (err) {
    res.status(500).send('Error cargando index.html');
  }
});

// ============================================================
// MANEJADOR DE ERRORES
// ============================================================

app.use((error, _req, res, _next) => {
  console.error('Error en la petición:', error);

  const status = error instanceof multer.MulterError ? 400 : 400;

  res.status(status).json({
    error: error.message || 'Solicitud no válida'
  });
});

// ============================================================
// KEEP-ALIVE (evita que Render Free se duerma)
// ============================================================

function startKeepAlive() {
  const host =
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RENDER_EXTERNAL_HOSTNAME;

  if (!host) {
    console.log('Keep-alive desactivado (no se detectó entorno Render)');
    return;
  }

  const pingUrl = host.startsWith('http')
    ? `${host}/health`
    : `https://${host}/health`;

  console.log(`Keep-alive activado → cada 14 minutos a ${pingUrl}`);

  setInterval(async () => {
    try {
      const response = await fetch(pingUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'SekaiKeepAlive/1.0'
        }
      });

      if (response.ok) {
        console.log(`[Keep-alive] OK → ${new Date().toISOString()}`);
      } else {
        console.warn(`[Keep-alive] Respuesta ${response.status}`);
      }
    } catch (err) {
      console.error('[Keep-alive] Error:', err.message);
    }
  }, 14 * 60 * 1000);
}

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {
  console.log('================================================');
  console.log(`  Sekai Music Server`);
  console.log(`  Puerto: ${PORT}`);
  console.log(`  Tracks: ${catalog.length}`);
  console.log(`  Storage: ${useSupabase ? 'Supabase' : 'Local'}`);
  console.log('================================================');

  startKeepAlive();
});

