const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws'); // ← NECESARIO para Node 20

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;

const DATA_DIR = process.env.DATA_DIR || ROOT;
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(DATA_DIR, 'music');
const COVERS_DIR = process.env.COVERS_DIR || path.join(DATA_DIR, 'covers');
const CATALOG_FILE =
  process.env.CATALOG_FILE || path.join(DATA_DIR, 'catalog.json');

const API_KEY_FILE = path.join(DATA_DIR, 'api-key.json');

// ===============================
// SUPABASE
// ===============================

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();

const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim();

const SUPABASE_BUCKET = (
  process.env.SUPABASE_BUCKET || 'music'
).trim();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        realtime: {
          transport: ws // ← FIX para Node 20
        }
      })
    : null;

const useSupabase = Boolean(supabase);

// ===============================
// API KEY
// ===============================

function getOrCreateApiKey() {
  if (process.env.API_KEY && process.env.API_KEY.trim()) {
    return process.env.API_KEY.trim();
  }

  try {
    if (fs.existsSync(API_KEY_FILE)) {
      const saved = JSON.parse(
        fs.readFileSync(API_KEY_FILE, 'utf8')
      );

      if (
        saved &&
        typeof saved.key === 'string' &&
        saved.key.length >= 32
      ) {
        return saved.key;
      }
    }
  } catch (_) {}

  const key = crypto.randomBytes(32).toString('hex');

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
    {
      mode: 0o600
    }
  );

  console.log(
    'API KEY — guárdala, es necesaria para acceder al servidor:',
    key
  );

  return key;
}

const API_KEY = getOrCreateApiKey();

function requireApiKey(req, res, next) {
  const supplied =
    req.get('x-api-key') ||
    req.query.api_key ||
    '';

  if (supplied !== API_KEY) {
    return res.status(401).json({
      error: 'API key inválida o faltante'
    });
  }

  next();
}

// ===============================
// CARPETAS
// ===============================

for (const directory of [MUSIC_DIR, COVERS_DIR]) {
  fs.mkdirSync(directory, { recursive: true });
}

// ===============================
// EXPRESS
// ===============================

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

// Servir música local cuando Supabase no está configurado
app.use(
  '/music',
  requireApiKey,
  express.static(MUSIC_DIR, {
    acceptRanges: true
  })
);

// Servir covers locales cuando Supabase no está configurado
app.use(
  '/covers',
  requireApiKey,
  express.static(COVERS_DIR)
);

// ===============================
// FUNCIONES GENERALES
// ===============================

function cleanName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/[^\p{L}\p{N}._ ()\-]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function ext(name) {
  return path.extname(name).toLowerCase();
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
  const base = name.replace(
    /\.(mp3|m4a|wav|ogg|flac)$/i,
    ''
  );

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
    const data = JSON.parse(
      fs.readFileSync(CATALOG_FILE, 'utf8')
    );

    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeCatalog(catalogData) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  fs.writeFileSync(
    CATALOG_FILE,
    JSON.stringify(catalogData, null, 2)
  );
}

function findCoverExt(title) {
  const base = slug(title);

  for (const extension of [
    'jpg',
    'jpeg',
    'png',
    'webp'
  ]) {
    if (
      fs.existsSync(
        path.join(
          COVERS_DIR,
          `\( {base}. \){extension}`
        )
      )
    ) {
      return extension;
    }
  }

  return null;
}

function localUrl(folder, filename) {
  return `/\( {folder}/ \){encodeURIComponent(
    filename
  )}?api_key=${encodeURIComponent(API_KEY)}`;
}

function publicStorageUrl(folder, filename) {
  return `\( {SUPABASE_URL}/storage/v1/object/public/ \){SUPABASE_BUCKET}/\( {folder}/ \){encodeURIComponent(
    filename
  )}`;
}

// ===============================
// CATÁLOGO LOCAL
// ===============================

function scanCatalog() {
  const oldCatalog = readCatalog();

  const byFile = Object.fromEntries(
    oldCatalog.map(track => [
      track.fileName,
      track
    ])
  );

  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter(file =>
      /\.(mp3|m4a|wav|ogg|flac)$/i.test(file)
    );

  const catalogData = files.map((fileName, index) => {
    const previous = byFile[fileName] || {};
    const parsed = parseFilename(fileName);

    const id =
      previous.id ||
      `sekai-\( {Date.now()}- \){index}`;

    const coverName =
      previous.coverFile ||
      `${slug(
        previous.title || parsed.title
      )}.${
        findCoverExt(
          previous.title || parsed.title
        ) || 'jpg'
      }`;

    const coverExists =
      coverName &&
      fs.existsSync(
        path.join(COVERS_DIR, coverName)
      );

    return {
      id,

      title:
        previous.title ||
        parsed.title,

      artist:
        previous.artist ||
        parsed.artist,

      album:
        previous.album || '',

      year:
        previous.year || '',

      fileName,

      file: localUrl(
        'music',
        fileName
      ),

      cover: coverExists
        ? localUrl(
            'covers',
            coverName
          )
        : previous.cover || null,

      coverFile: coverExists
        ? coverName
        : previous.coverFile || null,

      duration:
        previous.duration || null
    };
  });

  writeCatalog(catalogData);

  return catalogData;
}

let catalog = scanCatalog();

// ===============================
// CATÁLOGO SUPABASE
// ===============================

function convertSupabaseTrack(row) {
  const fileName =
    row.file_name ||
    row.fileName ||
    row.filename ||
    null;

  const coverFile =
    row.cover_file ||
    row.coverFile ||
    null;

  return {
    id: String(row.id),

    title:
      row.title || '',

    artist:
      row.artist || '',

    album:
      row.album || '',

    year:
      row.year || '',

    fileName,

    file:
      row.file_url ||
      (
        fileName
          ? publicStorageUrl(
              'music',
              fileName
            )
          : null
      ),

    cover:
      row.cover_url ||
      (
        coverFile
          ? publicStorageUrl(
              'covers',
              coverFile
            )
          : null
      ),

    coverFile,

    duration:
      row.duration || null
  };
}

async function getRemoteCatalog() {
  const result = await supabase
    .from('music_tracks')
    .select('*')
    .order('created_at', {
      ascending: true
    });

  if (result.error) {
    throw result.error;
  }

  return (result.data || []).map(
    convertSupabaseTrack
  );
}

async function refreshCatalog() {
  if (useSupabase) {
    try {
      catalog = await getRemoteCatalog();

      return catalog;
    } catch (error) {
      console.error(
        'Error leyendo catálogo de Supabase:',
        error.message
      );
    }
  }

  catalog = scanCatalog();

  return catalog;
}

// ===============================
// MULTER
// ===============================

// memoryStorage permite enviar los archivos
// a Supabase o guardarlos localmente.
const storage = multer.memoryStorage();

const upload = multer({
  storage,

  limits: {
    fileSize: 100 * 1024 * 1024
  },

  fileFilter: (_req, file, callback) => {
    if (
      file.fieldname === 'song' &&
      !/\.(mp3|m4a|wav|ogg|flac)$/i.test(
        file.originalname
      )
    ) {
      return callback(
        new Error(
          'Formato de canción no permitido'
        )
      );
    }

    if (
      file.fieldname === 'cover' &&
      !/^image\/(jpeg|png|webp)$/i.test(
        file.mimetype
      )
    ) {
      return callback(
        new Error(
          'La cover debe ser JPG, PNG o WEBP'
        )
      );
    }

    callback(null, true);
  }
});

// ===============================
// HEALTH
// ===============================

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'sekai-music-server',
    storage: useSupabase
      ? 'supabase'
      : 'local',
    tracks: catalog.length
  });
});

// ===============================
// CATÁLOGO
// ===============================

app.get(
  '/api/catalog',
  requireApiKey,
  async (_req, res) => {
    await refreshCatalog();

    res.json({
      source: 'sekai-music-server',

      storage: useSupabase
        ? 'supabase'
        : 'local',

      total: catalog.length,

      data: catalog
    });
  }
);

app.get(
  '/catalog.json',
  requireApiKey,
  async (_req, res) => {
    await refreshCatalog();

    res.json(catalog);
  }
);

app.post(
  '/api/rescan',
  requireApiKey,
  async (_req, res) => {
    await refreshCatalog();

    res.json({
      ok: true,
      total: catalog.length,
      data: catalog
    });
  }
);

// ===============================
// SUBIR CANCIÓN
// ===============================

app.post(
  '/api/upload',
  requireApiKey,
  upload.fields([
    {
      name: 'song',
      maxCount: 1
    },
    {
      name: 'cover',
      maxCount: 1
    }
  ]),
  async (req, res, next) => {
    try {
      const song =
        req.files?.song?.[0];

      const cover =
        req.files?.cover?.[0];

      if (!song) {
        return res.status(400).json({
          error: 'Falta la canción'
        });
      }

      const parsed = parseFilename(
        song.originalname
      );

      const title = String(
        req.body.title ||
        parsed.title
      ).trim();

      const artist = String(
        req.body.artist ||
        parsed.artist
      ).trim();

      const album = String(
        req.body.album || ''
      ).trim();

      const year = String(
        req.body.year || ''
      ).trim();

      const id =
        `sekai-\( {Date.now()}- \){Math.random()
          .toString(36)
          .slice(2, 8)}`;

      const songName =
        `\( {Date.now()}- \){cleanName(
          song.originalname
        )}`;

      const coverName = cover
        ? `\( {Date.now()}- \){cleanName(
            cover.originalname
          )}`
        : null;

      // =========================
      // SUBIDA A SUPABASE
      // =========================

      if (useSupabase) {
        const songPath =
          `music/${songName}`;

        let uploadResult =
          await supabase.storage
            .from(SUPABASE_BUCKET)
            .upload(
              songPath,
              song.buffer,
              {
                contentType:
                  song.mimetype,

                upsert: false
              }
            );

        if (uploadResult.error) {
          throw uploadResult.error;
        }

        if (cover) {
          uploadResult =
            await supabase.storage
              .from(SUPABASE_BUCKET)
              .upload(
                `covers/${coverName}`,
                cover.buffer,
                {
                  contentType:
                    cover.mimetype,

                  upsert: false
                }
              );

          if (uploadResult.error) {
            await supabase.storage
              .from(SUPABASE_BUCKET)
              .remove([
                songPath
              ]);

            throw uploadResult.error;
          }
        }

        const row = {
          id,

          title,

          artist,

          album,

          year,

          file_name:
            songName,

          cover_file:
            coverName,

          duration:
            null,

          file_url:
            publicStorageUrl(
              'music',
              songName
            ),

          cover_url:
            coverName
              ? publicStorageUrl(
                  'covers',
                  coverName
                )
              : null
        };

        const insertResult =
          await supabase
            .from('music_tracks')
            .insert(row)
            .select()
            .single();

        if (insertResult.error) {
          await supabase.storage
            .from(SUPABASE_BUCKET)
            .remove([
              songPath,

              ...(coverName
                ? [`covers/${coverName}`]
                : [])
            ]);

          throw insertResult.error;
        }

        await refreshCatalog();

        return res.status(201).json({
          ok: true,

          track:
            convertSupabaseTrack(
              insertResult.data
            ),

          total:
            catalog.length
        });
      }

      // =========================
      // SUBIDA LOCAL
      // =========================

      const songPath = path.join(
        MUSIC_DIR,
        songName
      );

      fs.writeFileSync(
        songPath,
        song.buffer
      );

      if (cover) {
        const coverPath = path.join(
          COVERS_DIR,
          coverName
        );

        fs.writeFileSync(
          coverPath,
          cover.buffer
        );
      }

      const track = {
        id,

        title,

        artist,

        album,

        year,

        fileName:
          songName,

        file:
          localUrl(
            'music',
            songName
          ),

        cover:
          cover
            ? localUrl(
                'covers',
                coverName
              )
            : null,

        coverFile:
          coverName,

        duration:
          null
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

// ===============================
// ELIMINAR CANCIÓN
// ===============================

app.delete(
  '/api/tracks/:id',
  requireApiKey,
  async (req, res, next) => {
    try {
      const track = catalog.find(
        item =>
          String(item.id) ===
          String(req.params.id)
      );

      if (!track) {
        return res.status(404).json({
          error: 'Canción no encontrada'
        });
      }

      // =========================
      // ELIMINAR DE SUPABASE
      // =========================

      if (useSupabase) {
        const storagePaths = [
          `music/${track.fileName}`,

          ...(track.coverFile
            ? [`covers/${track.coverFile}`]
            : [])
        ];

        const removeResult =
          await supabase.storage
            .from(SUPABASE_BUCKET)
            .remove(storagePaths);

        if (removeResult.error) {
          console.error(
            'Error eliminando archivos:',
            removeResult.error.message
          );
        }

        const deleteResult =
          await supabase
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

      // =========================
      // ELIMINAR LOCALMENTE
      // =========================

      const index = catalog.findIndex(
        item =>
          String(item.id) ===
          String(req.params.id)
      );

      if (index < 0) {
        return res.status(404).json({
          error: 'Canción no encontrada'
        });
      }

      const [removedTrack] =
        catalog.splice(index, 1);

      const filesToDelete = [
        [
          removedTrack.fileName,
          MUSIC_DIR
        ],
        [
          removedTrack.coverFile,
          COVERS_DIR
        ]
      ];

      for (const [
        filename,
        directory
      ] of filesToDelete) {
        if (!filename) continue;

        const safeFilename =
          path.basename(
            String(filename)
          );

        const directoryPath =
          path.resolve(directory);

        const filePath =
          path.resolve(
            directory,
            safeFilename
          );

        if (
          filePath.startsWith(
            directoryPath + path.sep
          ) &&
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
  }
);

// ===============================
// LYRICS
// ===============================

app.get(
  '/api/lyrics',
  requireApiKey,
  async (req, res) => {
    const artist = String(
      req.query.artist || ''
    ).trim();

    const title = String(
      req.query.title || ''
    ).trim();

    if (!title) {
      return res.status(400).json({
        error: 'title requerido'
      });
    }

    try {
      const query = encodeURIComponent(
        `${artist} ${title}`.trim()
      );

      const response = await fetch(
        `https://lrclib.net/api/search?q=${query}`,
        {
          headers: {
            'User-Agent':
              'SekaiMusicServer/1.0'
          }
        }
      );

      if (response.ok) {
        const results =
          await response.json();

        const best =
          Array.isArray(results)
            ? results.find(
                item =>
                  item.syncedLyrics ||
                  item.plainLyrics
              )
            : null;

        if (best) {
          return res.json({
            source: 'lrclib',

            artist:
              best.artistName ||
              artist,

            title:
              best.trackName ||
              title,

            lyrics:
              best.plainLyrics || '',

            synced:
              best.syncedLyrics || null
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
  }
);

// ===============================
// INDEX.HTML
// ===============================

app.get('/', (_req, res) => {
  const indexPath =
    path.join(ROOT, 'index.html');

  const html =
    fs.readFileSync(
      indexPath,
      'utf8'
    );

  const injected =
    html.replace(
      '<!-- API_KEY_INJECT -->',
      `<script>
        window.SEKAI_API_KEY=${JSON.stringify(
          API_KEY
        )};
      </script>`
    );

  res.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  res.type('html').send(injected);
});

// ===============================
// ERRORES
// ===============================

app.use(
  (error, _req, res, _next) => {
    console.error(error);

    const status =
      error instanceof multer.MulterError
        ? 400
        : 400;

    res.status(status).json({
      error:
        error.message ||
        'Solicitud no válida'
    });
  }
);

// ===============================
// INICIAR SERVIDOR
// ===============================

app.listen(
  PORT,
  () => {
    console.log(
      `Sekai Music Server on :${PORT} · ${catalog.length} tracks · ${
        useSupabase
          ? 'Supabase'
          : 'local'
      }`
    );
  }
);
