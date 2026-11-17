"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const SOURCE_DIR = path.join(ROOT, "src");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "lucimon-library.sqlite");
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["Dunia", "Karakter", "Alur", "Tempat", "Catatan"]);
const IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: "png", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ["image/webp", { extension: "webp", signature: (buffer) => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" }],
  ["image/gif", { extension: "gif", signature: (buffer) => ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString()) }]
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const database = new DatabaseSync(DB_PATH);
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    parent_id TEXT NOT NULL DEFAULT '',
    related_ids TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    image_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const insertNote = database.prepare(`
  INSERT INTO notes (id, title, type, summary, content, parent_id, related_ids, tags, image_url, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectNotes = database.prepare("SELECT * FROM notes ORDER BY updated_at DESC");
const selectNote = database.prepare("SELECT * FROM notes WHERE id = ?");
const countNotes = database.prepare("SELECT COUNT(*) AS count FROM notes");

function mapNote(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    summary: row.summary,
    content: row.content,
    parentId: row.parent_id,
    relatedIds: JSON.parse(row.related_ids),
    tags: JSON.parse(row.tags),
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function addSeedNotes() {
  if (countNotes.get().count > 0) return;
  const now = new Date().toISOString();
  const examples = [
    { id: "contoh-dunia", title: "Kepulauan yang berpindah", type: "Dunia", summary: "Gugusan pulau melayang yang berpindah tempat mengikuti arus angin dan musim.", content: "Contoh catatan dunia.\n\nPulau-pulau ini tidak pernah benar-benar berada di tempat yang sama. Para pelaut membaca arah perpindahannya dari warna awan dan suara lonceng di menara.", parentId: "", relatedIds: ["contoh-karakter"], tags: ["contoh", "dunia", "fantasi"], imageUrl: "" },
    { id: "contoh-karakter", title: "Mira, penjaga peta", type: "Karakter", summary: "Seorang pembuat peta yang mencari pulau tempat keluarganya menghilang.", content: "Contoh catatan karakter.\n\nMira mengumpulkan peta dari setiap pelabuhan. Ia percaya ada satu jalur yang muncul hanya sekali dalam satu generasi.", parentId: "contoh-dunia", relatedIds: ["contoh-alur"], tags: ["contoh", "karakter"], imageUrl: "" },
    { id: "contoh-alur", title: "Peta yang berubah saat malam", type: "Alur", summary: "Sebuah peta tua menggambar rute baru setiap kali bulan tertutup awan.", content: "Contoh catatan alur.\n\nMira menemukan bahwa garis pada peta bukan menunjukkan tempat, melainkan urutan pulau yang akan dilewati. Ada satu nama yang selalu terhapus sebelum fajar.", parentId: "contoh-dunia", relatedIds: ["contoh-karakter"], tags: ["contoh", "misteri", "alur"], imageUrl: "" }
  ];
  database.exec("BEGIN");
  try {
    for (const note of examples) {
      insertNote.run(note.id, note.title, note.type, note.summary, note.content, note.parentId, JSON.stringify(note.relatedIds), JSON.stringify(note.tags), note.imageUrl, now, now);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateNote(input, id, validIds = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw httpError(400, "Format catatan tidak valid.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const type = TYPES.has(input.type) ? input.type : "Catatan";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  const parentId = typeof input.parentId === "string" ? input.parentId : "";
  const relatedIds = Array.isArray(input.relatedIds) ? [...new Set(input.relatedIds.filter((value) => typeof value === "string" && value))] : [];
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl : "";

  if (!title || title.length > 120) throw httpError(400, "Judul wajib diisi dan maksimal 120 karakter.");
  if (summary.length > 500) throw httpError(400, "Ringkasan maksimal 500 karakter.");
  if (content.length > 500_000) throw httpError(400, "Isi catatan terlalu panjang.");
  if (tags.length > 30 || tags.some((tag) => tag.length > 40)) throw httpError(400, "Maksimal 30 tag; setiap tag maksimal 40 karakter.");
  if (id && (parentId === id || relatedIds.includes(id))) throw httpError(400, "Catatan tidak dapat terhubung dengan dirinya sendiri.");
  if (imageUrl && !/^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp|gif)$/.test(imageUrl)) throw httpError(400, "Alamat gambar tidak valid.");

  if (validIds) {
    if (parentId && !validIds.has(parentId)) throw httpError(400, "Catatan induk tidak ditemukan dalam cadangan.");
    if (relatedIds.some((relatedId) => !validIds.has(relatedId))) throw httpError(400, "Ada catatan terhubung yang tidak ditemukan dalam cadangan.");
  } else {
    if (parentId && !selectNote.get(parentId)) throw httpError(400, "Catatan induk tidak ditemukan.");
    if (relatedIds.some((relatedId) => !selectNote.get(relatedId))) throw httpError(400, "Catatan terhubung tidak ditemukan.");
    let current = parentId;
    const visited = new Set();
    while (current) {
      if (current === id || visited.has(current)) throw httpError(400, "Hubungan parent tidak boleh membentuk lingkaran.");
      visited.add(current);
      const parent = selectNote.get(current);
      current = parent ? parent.parent_id : "";
    }
  }

  const existing = id ? selectNote.get(id) : null;
  const now = new Date().toISOString();
  return {
    id: id || crypto.randomUUID(),
    title,
    type,
    summary,
    content,
    parentId,
    relatedIds,
    tags,
    imageUrl,
    createdAt: existing ? existing.created_at : now,
    updatedAt: now
  };
}

function saveNote(note) {
  insertNote.run(note.id, note.title, note.type, note.summary, note.content, note.parentId, JSON.stringify(note.relatedIds), JSON.stringify(note.tags), note.imageUrl, note.createdAt, note.updatedAt);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, "Ukuran kiriman terlalu besar.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Isi permintaan bukan JSON yang valid.");
  }
}

function validateImport(input) {
  const source = Array.isArray(input) ? input : input && input.notes;
  if (!Array.isArray(source)) throw httpError(400, "Cadangan harus berisi daftar catatan.");
  const ids = source.map((note) => note && note.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw httpError(400, "Setiap catatan harus memiliki ID unik.");
  }
  const validIds = new Set(ids);
  const imported = source.map((note) => validateNote(note, note.id, validIds));
  const parentMap = new Map(imported.map((note) => [note.id, note.parentId]));
  for (const note of imported) {
    let current = note.parentId;
    const seen = new Set([note.id]);
    while (current) {
      if (seen.has(current)) throw httpError(400, "Hubungan parent dalam cadangan membentuk lingkaran.");
      seen.add(current);
      current = parentMap.get(current) || "";
    }
  }
  return imported;
}

function mimeFor(filename) {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" })[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

function serveStatic(request, response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(response, 400, { error: "Alamat tidak valid." });
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filename = path.resolve(SOURCE_DIR, relative);
  if (!filename.startsWith(SOURCE_DIR + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404);
    return response.end("Not found");
  }
  response.writeHead(200, {
    "Content-Type": mimeFor(filename),
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex"
  });
  fs.createReadStream(filename).pipe(response);
}

function serveUpload(response, pathname) {
  const filename = path.basename(pathname);
  if (!/^[a-f0-9-]+\.(?:jpg|png|webp|gif)$/.test(filename)) {
    response.writeHead(404);
    return response.end();
  }
  const fullPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    response.writeHead(404);
    return response.end();
  }
  const mime = [...IMAGE_TYPES.entries()].find(([, value]) => value.extension === path.extname(filename).slice(1))?.[0] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=86400" });
  fs.createReadStream(fullPath).pipe(response);
}

async function handleApi(request, response, url) {
  const pathname = url.pathname;
  if (request.method === "GET" && pathname === "/api/notes") {
    return sendJson(response, 200, selectNotes.all().map(mapNote));
  }
  if (request.method === "GET" && pathname === "/api/export") {
    return sendJson(response, 200, { version: 1, exportedAt: new Date().toISOString(), notes: selectNotes.all().map(mapNote) });
  }
  if (request.method === "POST" && pathname === "/api/notes") {
    const note = validateNote(await readJson(request), "");
    saveNote(note);
    return sendJson(response, 201, note);
  }
  if (request.method === "PUT" && pathname === "/api/import") {
    const imported = validateImport(await readJson(request));
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec("DELETE FROM notes");
      for (const note of imported) saveNote(note);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return sendJson(response, 200, { count: imported.length });
  }
  if (request.method === "POST" && pathname === "/api/images") {
    const input = await readJson(request);
    if (!input || typeof input.data !== "string" || typeof input.mime !== "string") throw httpError(400, "Data gambar tidak valid.");
    const imageType = IMAGE_TYPES.get(input.mime);
    if (!imageType) throw httpError(415, "Gunakan gambar JPEG, PNG, WebP, atau GIF.");
    const data = input.data.replace(/^data:[^,]+,/, "");
    const image = Buffer.from(data, "base64");
    if (!image.length || image.length > MAX_IMAGE_BYTES) throw httpError(413, "Ukuran gambar maksimal 5 MB.");
    if (!imageType.signature(image)) throw httpError(400, "Isi file tidak sesuai dengan format gambar.");
    const filename = `${crypto.randomUUID()}.${imageType.extension}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), image, { flag: "wx" });
    return sendJson(response, 201, { imageUrl: `/uploads/${filename}` });
  }

  const imageMatch = pathname.match(/^\/api\/images\/([a-f0-9-]+\.(?:jpg|png|webp|gif))$/);
  if (request.method === "DELETE" && imageMatch) {
    const imageUrl = `/uploads/${imageMatch[1]}`;
    const referenced = database.prepare("SELECT 1 FROM notes WHERE image_url = ? LIMIT 1").get(imageUrl);
    if (!referenced) await fs.promises.rm(path.join(UPLOAD_DIR, imageMatch[1]), { force: true });
    return sendJson(response, 200, { removed: !referenced });
  }

  const noteMatch = pathname.match(/^\/api\/notes\/([a-f0-9-]+)$/);
  if (request.method === "PUT" && noteMatch) {
    const id = noteMatch[1];
    if (!selectNote.get(id)) throw httpError(404, "Catatan tidak ditemukan.");
    const note = validateNote(await readJson(request), id);
    database.prepare(`
      UPDATE notes SET title=?, type=?, summary=?, content=?, parent_id=?, related_ids=?, tags=?, image_url=?, updated_at=?
      WHERE id=?
    `).run(note.title, note.type, note.summary, note.content, note.parentId, JSON.stringify(note.relatedIds), JSON.stringify(note.tags), note.imageUrl, note.updatedAt, id);
    return sendJson(response, 200, note);
  }
  if (request.method === "DELETE" && noteMatch) {
    const id = noteMatch[1];
    const row = selectNote.get(id);
    if (!row) throw httpError(404, "Catatan tidak ditemukan.");
    const note = mapNote(row);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE notes SET parent_id = ? WHERE parent_id = ?").run(note.parentId, id);
      const rows = selectNotes.all();
      const updateRelated = database.prepare("UPDATE notes SET related_ids = ? WHERE id = ?");
      for (const item of rows) {
        const relatedIds = JSON.parse(item.related_ids).filter((relatedId) => relatedId !== id);
        if (relatedIds.length !== JSON.parse(item.related_ids).length) updateRelated.run(JSON.stringify(relatedIds), item.id);
      }
      database.prepare("DELETE FROM notes WHERE id = ?").run(id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    if (note.imageUrl) {
      const referenced = database.prepare("SELECT 1 FROM notes WHERE image_url = ? LIMIT 1").get(note.imageUrl);
      if (!referenced) await fs.promises.rm(path.join(UPLOAD_DIR, path.basename(note.imageUrl)), { force: true });
    }
    return sendJson(response, 200, { deleted: id });
  }
  return sendJson(response, 404, { error: "API tidak ditemukan." });
}

addSeedNotes();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(request, response, url);
    }
    if (url.pathname.startsWith("/uploads/")) {
      return serveUpload(response, url.pathname);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Metode tidak diizinkan." });
    }
    return serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error("Permintaan gagal:", error);
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : "Terjadi kesalahan server." });
    else response.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Lucimon Library berjalan di http://${HOST}:${PORT}`);
  console.log(`Database tersimpan di ${DB_PATH}`);
});

function close() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
