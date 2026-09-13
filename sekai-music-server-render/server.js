const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(DATA_DIR, 'music');
const COVERS_DIR = process.env.COVERS_DIR || path.join(DATA_DIR, 'covers');
const CATALOG_FILE = process.env.CATALOG_FILE || path.join(DATA_DIR, 'catalog.json');

for (const d of [MUSIC_DIR, COVERS_DIR]) fs.mkdirSync(d, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/music', express.static(MUSIC_DIR, { acceptRanges: true }));
app.use('/covers', express.static(COVERS_DIR));

function cleanName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/[^\p{L}\p{N}._ ()\-]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}
function ext(name) { return path.extname(name).toLowerCase(); }
function slug(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
}
function parseFilename(name) {
  const base = name.replace(/\.(mp3|m4a|wav|ogg|flac)$/i, '');
  const p = base.split(' - ');
  return p.length >= 2
    ? { artist: p[0].trim(), title: p.slice(1).join(' - ').trim() }
    : { artist: 'Unknown', title: base };
}
function readCatalog() {
  try { const x = JSON.parse(fs.readFileSync(CATALOG_FILE,'utf8')); return Array.isArray(x) ? x : []; }
  catch { return []; }
}
function writeCatalog(c) { fs.writeFileSync(CATALOG_FILE, JSON.stringify(c, null, 2)); }
function scanCatalog() {
  const old = readCatalog();
  const byFile = Object.fromEntries(old.map(t => [t.fileName, t]));
  const files = fs.readdirSync(MUSIC_DIR).filter(f => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f));
  const used = new Set();
  const catalog = files.map((fileName, i) => {
    const prev = byFile[fileName] || {};
    const parsed = parseFilename(fileName);
    const id = prev.id || `sekai-${Date.now()}-${i}`;
    used.add(id);
    const coverName = prev.coverFile || `${slug(prev.title || parsed.title)}.${findCoverExt(prev.title || parsed.title) || 'jpg'}`;
    const coverExists = coverName && fs.existsSync(path.join(COVERS_DIR, coverName));
    return {
      id,
      title: prev.title || parsed.title,
      artist: prev.artist || parsed.artist,
      album: prev.album || '',
      year: prev.year || '',
      fileName,
      file: `/music/${encodeURIComponent(fileName)}`,
      cover: coverExists ? `/covers/${encodeURIComponent(coverName)}` : (prev.cover || null),
      coverFile: coverExists ? coverName : (prev.coverFile || null),
      duration: prev.duration || null
    };
  });
  writeCatalog(catalog);
  return catalog;
}
function findCoverExt(title) {
  const base = slug(title);
  for (const e of ['jpg','jpeg','png','webp']) if (fs.existsSync(path.join(COVERS_DIR, `${base}.${e}`))) return e;
  return null;
}
let catalog = scanCatalog();

const storage = multer.diskStorage({
  destination: (_req, file, cb) => cb(null, file.fieldname === 'cover' ? COVERS_DIR : MUSIC_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${cleanName(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'song' && !/\.(mp3|m4a|wav|ogg|flac)$/i.test(file.originalname)) return cb(new Error('Formato de canción no permitido'));
    if (file.fieldname === 'cover' && !/^image\/(jpeg|png|webp)$/i.test(file.mimetype)) return cb(new Error('Cover debe ser JPG, PNG o WEBP'));
    cb(null, true);
  }
});

app.get('/health', (_req,res)=>res.json({ok:true, service:'sekai-music-server', tracks:catalog.length}));
app.get('/api/catalog', (_req,res)=>res.json({source:'sekai-music-server', total:catalog.length, data:catalog}));
app.get('/catalog.json', (_req,res)=>res.json(catalog));
app.post('/api/rescan', (_req,res)=>{ catalog=scanCatalog(); res.json({ok:true,total:catalog.length,data:catalog}); });

app.post('/api/upload', upload.fields([{name:'song',maxCount:1},{name:'cover',maxCount:1}]), (req,res)=>{
  const song = req.files?.song?.[0];
  const cover = req.files?.cover?.[0];
  if (!song) return res.status(400).json({error:'Falta la canción'});
  const title = String(req.body.title || parseFilename(song.originalname).title).trim();
  const artist = String(req.body.artist || parseFilename(song.originalname).artist).trim();
  const album = String(req.body.album || '').trim();
  const year = String(req.body.year || '').trim();
  const id = `sekai-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const track = { id, title, artist, album, year, fileName:song.filename, file:`/music/${encodeURIComponent(song.filename)}`, cover:cover?`/covers/${encodeURIComponent(cover.filename)}`:null, coverFile:cover?cover.filename:null, duration:null };
  catalog.push(track); writeCatalog(catalog);
  res.status(201).json({ok:true,track,total:catalog.length});
});

app.delete('/api/tracks/:id', (req,res)=>{
  const idx=catalog.findIndex(t=>String(t.id)===String(req.params.id));
  if(idx<0) return res.status(404).json({error:'Canción no encontrada'});
  const [t]=catalog.splice(idx,1);
  for(const f of [t.fileName,t.coverFile]) if(f){const base=f.includes('/')?path.basename(f):f; const p=path.join(t.coverFile?COVERS_DIR:MUSIC_DIR,base); if(fs.existsSync(p)) fs.unlinkSync(p);}
  writeCatalog(catalog); res.json({ok:true,total:catalog.length});
});

app.get('/api/lyrics', async (req,res)=>{
  const artist=String(req.query.artist||'').trim(), title=String(req.query.title||'').trim();
  if(!title) return res.status(400).json({error:'title requerido'});
  try{
    const q=encodeURIComponent(`${artist} ${title}`.trim());
    const r=await fetch(`https://lrclib.net/api/search?q=${q}`,{headers:{'User-Agent':'SekaiMusicServer/1.0'}});
    if(r.ok){const a=await r.json(); const best=Array.isArray(a)?a.find(x=>x.syncedLyrics||x.plainLyrics):null;
      if(best) return res.json({source:'lrclib',artist:best.artistName||artist,title:best.trackName||title,lyrics:best.plainLyrics||'',synced:best.syncedLyrics||null});}
    res.status(404).json({error:'No se encontraron lyrics',artist,title});
  }catch(e){res.status(502).json({error:'Error al buscar lyrics'});}
});

app.get('/', (_req,res)=>res.sendFile(path.join(ROOT,'index.html')));
app.use((_err,_req,res,_next)=>res.status(400).json({error:'Solicitud no válida'}));
app.listen(PORT,()=>console.log(`Sekai Music Server on :${PORT} · ${catalog.length} tracks`));
