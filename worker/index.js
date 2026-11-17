import { createRemoteJWKSet, jwtVerify } from "jose";
import sanitizeHtml from "sanitize-html";

const ARTICLE_TYPES = new Set(["Dunia", "Karakter", "Alur", "Tempat", "Catatan"]);
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CONTENT_SANITIZER_OPTIONS = {
  allowedTags: [
    "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s",
    "ul", "ol", "li", "blockquote", "hr", "a", "pre", "code", "div"
  ],
  allowedAttributes: { a: ["href", "title"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false
};
let cachedJwks;
let cachedIssuer;

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function errorResponse(message, status = 400) {
  return json({ error: message }, status);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function plainTextToHtml(value) {
  return String(value || "").trim().split(/\n{2,}/).filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

function sanitizeArticleContent(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const html = /<\/?[a-z][^>]*>/i.test(raw) ? raw : plainTextToHtml(raw);
  return sanitizeHtml(html, CONTENT_SANITIZER_OPTIONS);
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

async function getIdentity(request, env) {
  if (env.LOCAL_DEV_AUTH === "true") {
    const hostname = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      throw new Response("Mode autentikasi lokal hanya diizinkan pada localhost.", { status: 503 });
    }
    const email = String(env.ADMIN_EMAIL || "owner@example.test").trim().toLowerCase();
    return {
      id: "local-dev-owner",
      email,
      name: String(env.ADMIN_NAME || email.split("@")[0])
    };
  }

  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").replace(/\/+$/, "");
  const audiences = String(env.ACCESS_AUD || "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!teamDomain || !audiences.length || !allowedEmail) {
    throw new Response("Cloudflare Access belum dikonfigurasi untuk pengelola.", { status: 503 });
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new Response("Login diperlukan.", { status: 401 });

  try {
    if (!cachedJwks || cachedIssuer !== teamDomain) {
      cachedIssuer = teamDomain;
      cachedJwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    }
    const { payload } = await jwtVerify(token, cachedJwks, {
      issuer: teamDomain,
      audience: audiences
    });
    const email = String(payload.email || "").trim().toLowerCase();
    if (!payload.sub || !email || email !== allowedEmail) {
      throw new Response("Akun ini tidak diizinkan mengelola perpustakaan.", { status: 403 });
    }
    return {
      id: String(payload.sub),
      email,
      name: String(payload.name || email.split("@")[0])
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    console.warn("Cloudflare Access token validation failed.");
    throw new Response("Sesi login tidak valid atau sudah berakhir.", { status: 401 });
  }
}

async function ensureProfile(env, identity) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO profiles (id, email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      updated_at = excluded.updated_at
  `).bind(identity.id, identity.email, identity.name, now, now).run();
  return env.DB.prepare("SELECT id, email, display_name AS displayName FROM profiles WHERE id = ?")
    .bind(identity.id).first();
}

function articleFromRow(row, admin = false) {
  let tags = [];
  try {
    const parsed = JSON.parse(row.tags_json || "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((tag) => typeof tag === "string");
  } catch {
    console.warn("Invalid tags_json found for an article.");
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    summary: row.summary,
    ...(row.content !== undefined ? { content: row.content } : {}),
    visibility: row.visibility,
    parentId: row.parent_id || "",
    parentSlug: row.parent_slug || "",
    parentTitle: row.parent_title || "",
    relatedIds: row.relatedIds || [],
    tags,
    imageKey: admin ? row.image_key || "" : undefined,
    imageUrl: row.image_key
      ? `${admin ? "/api/admin/images/" : "/media/"}${encodeURIComponent(row.image_key)}`
      : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function slugBase(title) {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "artikel";
}

async function validateRelations(env, identity, articleId, parentId, relatedIds) {
  if (parentId) {
    if (parentId === articleId) throw new InputError("Artikel tidak bisa menjadi parent untuk dirinya sendiri.");
    let currentId = parentId;
    const seen = new Set();
    while (currentId) {
      if (currentId === articleId || seen.has(currentId)) {
        throw new InputError("Hubungan parent tidak boleh membentuk lingkaran.");
      }
      seen.add(currentId);
      const current = await env.DB.prepare("SELECT parent_id FROM articles WHERE id = ? AND owner_id = ?")
        .bind(currentId, identity.id).first();
      if (!current) throw new InputError("Artikel parent tidak ditemukan.");
      currentId = current.parent_id || "";
    }
  }

  const uniqueRelatedIds = [...new Set(relatedIds.filter((id) => typeof id === "string" && id && id !== articleId))];
  if (uniqueRelatedIds.length > 100) throw new InputError("Pilih maksimal 100 artikel terkait.");
  if (uniqueRelatedIds.length) {
    const placeholders = uniqueRelatedIds.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM articles WHERE owner_id = ? AND id IN (${placeholders})`
    ).bind(identity.id, ...uniqueRelatedIds).first();
    if (Number(result?.count) !== uniqueRelatedIds.length) {
      throw new InputError("Satu atau beberapa artikel terkait tidak ditemukan.");
    }
  }
  return uniqueRelatedIds;
}

function validateArticleInput(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const type = body.type === undefined ? "Catatan" : body.type;
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const content = sanitizeArticleContent(typeof body.content === "string" ? body.content : "");
  const visibility = body.visibility === undefined ? "draft" : body.visibility;
  const parentId = typeof body.parentId === "string" ? body.parentId : "";
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))]
    : [];
  const relatedIds = Array.isArray(body.relatedIds) ? [...new Set(body.relatedIds)] : [];
  const imageKey = typeof body.imageKey === "string" ? body.imageKey : "";

  if (!title || title.length > 120) throw new InputError("Judul wajib diisi dan maksimal 120 karakter.");
  if (!ARTICLE_TYPES.has(type)) throw new InputError("Jenis artikel tidak valid.");
  if (!["draft", "published"].includes(visibility)) throw new InputError("Status artikel tidak valid.");
  if (summary.length > 500) throw new InputError("Ringkasan maksimal 500 karakter.");
  if (content.length > 200000) throw new InputError("Isi artikel maksimal 200.000 karakter.");
  if (tags.length > 30) throw new InputError("Maksimal 30 tag.");
  if (tags.some((tag) => tag.length > 50)) throw new InputError("Setiap tag maksimal 50 karakter.");
  if (imageKey && !/^images\/[a-f0-9-]+\.(jpg|png|webp|gif)$/.test(imageKey)) {
    throw new InputError("Gambar artikel tidak valid.");
  }
  return { title, type, summary, content, visibility, parentId, tags, relatedIds, imageKey };
}

async function assertOwnedImage(env, identity, imageKey) {
  if (!imageKey) return;
  const row = await env.DB.prepare("SELECT key FROM image_assets WHERE key = ? AND owner_id = ?")
    .bind(imageKey, identity.id).first();
  if (!row) throw new InputError("Gambar tidak ditemukan atau bukan milik akun ini.");
}

async function syncLinks(env, sourceId, relatedIds, now) {
  const statements = [
    env.DB.prepare("DELETE FROM article_links WHERE source_id = ?").bind(sourceId),
    ...relatedIds.map((targetId) => env.DB.prepare(
      "INSERT INTO article_links (source_id, target_id, created_at) VALUES (?, ?, ?)"
    ).bind(sourceId, targetId, now))
  ];
  await env.DB.batch(statements);
}

async function getArticle(env, identity, id) {
  const row = await env.DB.prepare(`
    SELECT a.*, p.slug AS parent_slug, p.title AS parent_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id
    WHERE a.id = ? AND a.owner_id = ?
  `).bind(id, identity.id).first();
  if (!row) return null;
  const links = await env.DB.prepare("SELECT target_id FROM article_links WHERE source_id = ? ORDER BY target_id")
    .bind(id).all();
  return articleFromRow({ ...row, relatedIds: links.results.map((link) => link.target_id) }, true);
}

async function getAdminArticles(env, identity) {
  const result = await env.DB.prepare(`
    SELECT a.*, p.slug AS parent_slug, p.title AS parent_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id
    WHERE a.owner_id = ?
    ORDER BY a.updated_at DESC
  `).bind(identity.id).all();
  const links = await env.DB.prepare(`
    SELECT l.source_id, l.target_id
    FROM article_links l
    JOIN articles a ON a.id = l.source_id
    WHERE a.owner_id = ?
  `).bind(identity.id).all();
  const bySource = new Map();
  for (const link of links.results) {
    const targets = bySource.get(link.source_id) || [];
    targets.push(link.target_id);
    bySource.set(link.source_id, targets);
  }
  return result.results.map((row) => articleFromRow({
    ...row,
    relatedIds: bySource.get(row.id) || []
  }, true));
}

async function publicArticles(env, query) {
  const needle = query.trim().slice(0, 100);
  const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await env.DB.prepare(`
    SELECT a.id, a.slug, a.title, a.type, a.summary,
      CASE WHEN p.id IS NOT NULL THEN a.parent_id ELSE NULL END AS parent_id,
      a.image_key, a.tags_json, a.created_at, a.updated_at,
      p.slug AS parent_slug, p.title AS parent_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id AND p.visibility = 'published'
    WHERE a.visibility = 'published'
      AND (? = '' OR a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\'
        OR a.content LIKE ? ESCAPE '\\' OR a.tags_json LIKE ? ESCAPE '\\')
    ORDER BY a.updated_at DESC
    LIMIT 500
  `).bind(needle, pattern, pattern, pattern, pattern).all();
  return rows.results.map((row) => articleFromRow(row));
}

function pageResponse(title, description, body, status = 200) {
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, follow">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#f5f8fc">
  <title>${escapeHtml(title)} · Lucimon Library</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="site-header">
    <div class="header-main">
      <a class="brand" href="/" aria-label="Lucimon Library, beranda">
        <span class="brand-mark" aria-hidden="true">L</span>
        <span class="brand-copy"><strong>Lucimon Library</strong><small>WIKI IMAJINASI PRIBADI</small></span>
      </a>
      <nav class="primary-nav" aria-label="Navigasi utama">
        <a class="nav-link" href="/">Beranda</a>
        <a class="nav-link" href="/#/all">Semua artikel</a>
      </nav>
      <div class="header-tools"><a class="button button-primary button-add" href="/admin">Masuk pengelola</a></div>
    </div>
  </header>
  <main class="main-area"><section class="page-content">${body}</section><footer class="footer-note">Lucimon Library · Perpustakaan untuk dunia yang terus tumbuh.</footer></main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, follow",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'"
    }
  });
}

function textContentHtml(content) {
  const safeContent = sanitizeArticleContent(content);
  return safeContent || '<p class="relation-empty">Artikel ini belum memiliki isi.</p>';
}

async function renderPublicArticle(env, slug) {
  const article = await env.DB.prepare(`
    SELECT a.*, p.slug AS parent_slug, p.title AS parent_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id AND p.visibility = 'published'
    WHERE a.slug = ? AND a.visibility = 'published'
  `).bind(slug).first();
  if (!article) return pageResponse("Artikel tidak ditemukan", "Artikel publik tidak ditemukan.", `
    <div class="not-found"><h1>Artikel tidak ditemukan</h1><p>Artikel ini mungkin belum diterbitkan atau sudah dihapus.</p><a class="back-link" href="/">← Kembali ke beranda</a></div>
  `, 404);

  const [childrenResult, relatedResult] = await Promise.all([
    env.DB.prepare("SELECT id, slug, title, type FROM articles WHERE parent_id = ? AND visibility = 'published' ORDER BY title")
      .bind(article.id).all(),
    env.DB.prepare(`
      SELECT a.id, a.slug, a.title, a.type
      FROM article_links l JOIN articles a ON a.id = l.target_id
      WHERE l.source_id = ? AND a.visibility = 'published'
      ORDER BY a.title
    `).bind(article.id).all()
  ]);
  const linkedArticle = (row) => `<a class="relation-link" href="/article/${encodeURIComponent(row.slug)}"><span>${escapeHtml(row.title)}</span><small>${escapeHtml(row.type)} →</small></a>`;
  const parent = article.parent_slug
    ? `<a class="relation-link" href="/article/${encodeURIComponent(article.parent_slug)}"><span>${escapeHtml(article.parent_title)}</span><small>Bagian induk →</small></a>`
    : '<div class="relation-empty">Artikel utama.</div>';
  const image = article.image_key
    ? `<img class="detail-image" src="/media/${encodeURIComponent(article.image_key)}" alt="Gambar ${escapeHtml(article.title)}">`
    : "";
  let tags = [];
  try {
    const parsed = JSON.parse(article.tags_json || "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((tag) => typeof tag === "string");
  } catch {
    console.warn("Invalid tags_json found while rendering a published article.");
  }
  const related = relatedResult.results.length
    ? relatedResult.results.map(linkedArticle).join("")
    : '<div class="relation-empty">Tidak ada artikel terkait.</div>';
  const children = childrenResult.results.length
    ? childrenResult.results.map(linkedArticle).join("")
    : '<div class="relation-empty">Belum ada turunan yang diterbitkan.</div>';
  const body = `
    <nav class="detail-breadcrumb" aria-label="Jejak navigasi"><a href="/">Beranda</a><span>/</span><span>${escapeHtml(article.title)}</span></nav>
    <article>
      ${image}
      <header class="detail-header">
        <span class="type-pill type-${escapeHtml(article.type.toLowerCase())}">${escapeHtml(article.type)}</span>
        <h1>${escapeHtml(article.title)}</h1>
        ${article.summary ? `<p class="detail-summary">${escapeHtml(article.summary)}</p>` : ""}
        <div class="eyebrow">DIPERBARUI ${escapeHtml(new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(article.updated_at)).toLocaleUpperCase("id"))}</div>
      </header>
      <div class="detail-content">${textContentHtml(article.content)}</div>
      ${tags.length ? `<div class="detail-tags">${tags.map((tag) => `<span class="tag"># ${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <section class="relation-grid" aria-label="Hubungan artikel">
        <div class="relation-panel"><h3>Bagian dari</h3>${parent}</div>
        <div class="relation-panel"><h3>Turunan · ${childrenResult.results.length}</h3>${children}</div>
        <div class="relation-panel"><h3>Terhubung dengan</h3>${related}</div>
      </section>
    </article>
    <a class="back-link" href="/">← Kembali ke beranda</a>`;
  return pageResponse(article.title, article.summary || article.title, body);
}

async function readJson(request, maxBytes = 7 * 1024 * 1024) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new InputError("Ukuran permintaan terlalu besar.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Permintaan tidak memiliki isi JSON.");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new InputError("Ukuran permintaan terlalu besar.", 413);
      }
      chunks.push(value);
    }
  } catch {
    if (total > maxBytes) throw new InputError("Ukuran permintaan terlalu besar.", 413);
    throw new InputError("Format JSON tidak valid.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new InputError("Format JSON tidak valid.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("Isi permintaan harus berupa objek JSON.");
  }
  return body;
}

async function createArticle(env, identity, body) {
  const input = validateArticleInput(body);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const parentId = input.parentId || null;
  const relatedIds = await validateRelations(env, identity, id, input.parentId, input.relatedIds);
  await assertOwnedImage(env, identity, input.imageKey);
  const slug = `${slugBase(input.title)}-${id.slice(0, 8)}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO articles (
        id, owner_id, slug, title, type, summary, content, visibility,
        parent_id, image_key, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, identity.id, slug, input.title, input.type, input.summary,
      input.content, input.visibility, parentId, input.imageKey, JSON.stringify(input.tags), now, now),
    ...relatedIds.map((targetId) => env.DB.prepare(
      "INSERT INTO article_links (source_id, target_id, created_at) VALUES (?, ?, ?)"
    ).bind(id, targetId, now))
  ];
  await env.DB.batch(statements);
  return getArticle(env, identity, id);
}

async function updateArticle(env, identity, id, body) {
  const current = await env.DB.prepare("SELECT id, slug FROM articles WHERE id = ? AND owner_id = ?")
    .bind(id, identity.id).first();
  if (!current) return null;
  const input = validateArticleInput(body);
  const parentId = input.parentId || null;
  const relatedIds = await validateRelations(env, identity, id, input.parentId, input.relatedIds);
  await assertOwnedImage(env, identity, input.imageKey);
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`
      UPDATE articles
      SET title = ?, type = ?, summary = ?, content = ?, visibility = ?,
        parent_id = ?, image_key = ?, tags_json = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).bind(input.title, input.type, input.summary, input.content, input.visibility,
      parentId, input.imageKey, JSON.stringify(input.tags), now, id, identity.id),
    env.DB.prepare("DELETE FROM article_links WHERE source_id = ?").bind(id),
    ...relatedIds.map((targetId) => env.DB.prepare(
      "INSERT INTO article_links (source_id, target_id, created_at) VALUES (?, ?, ?)"
    ).bind(id, targetId, now))
  ];
  await env.DB.batch(statements);
  return getArticle(env, identity, id);
}

async function uploadImage(request, env, identity) {
  const body = await readJson(request);
  const mime = typeof body.mime === "string" ? body.mime.toLowerCase() : "";
  const extension = IMAGE_TYPES.get(mime);
  if (!extension || typeof body.data !== "string") throw new InputError("Format gambar tidak didukung.");
  const match = body.data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].toLowerCase() !== mime) throw new InputError("Data gambar tidak valid.");
  const binary = atob(match[2]);
  if (!binary.length || binary.length > MAX_IMAGE_BYTES) throw new InputError("Ukuran gambar maksimal 5 MB.");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const signatures = {
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/png": [0x89, 0x50, 0x4e, 0x47],
    "image/gif": [0x47, 0x49, 0x46, 0x38],
    "image/webp": [0x52, 0x49, 0x46, 0x46]
  };
  const validSignature = mime === "image/webp"
    ? String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    : signatures[mime].every((byte, index) => bytes[index] === byte);
  if (!validSignature) {
    throw new InputError("Isi file tidak cocok dengan format gambar.");
  }
  const key = `images/${crypto.randomUUID()}.${extension}`;
  const now = new Date().toISOString();
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await env.DB.prepare(`
      INSERT INTO image_assets (key, owner_id, content_type, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(key, identity.id, mime, bytes.length, now).run();
  } catch (error) {
    await env.IMAGES.delete(key);
    throw error;
  }
  return { imageKey: key, imageUrl: `/media/${encodeURIComponent(key)}` };
}

async function deleteImage(env, identity, key) {
  const image = await env.DB.prepare("SELECT key FROM image_assets WHERE key = ? AND owner_id = ?")
    .bind(key, identity.id).first();
  if (!image) return false;
  const usage = await env.DB.prepare("SELECT COUNT(*) AS count FROM articles WHERE image_key = ?")
    .bind(key).first();
  if (Number(usage?.count) > 0) throw new InputError("Gambar masih dipakai oleh artikel.");
  await env.IMAGES.delete(key);
  await env.DB.prepare("DELETE FROM image_assets WHERE key = ? AND owner_id = ?")
    .bind(key, identity.id).run();
  return true;
}

async function imageResponse(env, key) {
  const object = await env.IMAGES.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

async function deleteArticle(env, identity, id) {
  const article = await env.DB.prepare("SELECT id, parent_id, image_key FROM articles WHERE id = ? AND owner_id = ?")
    .bind(id, identity.id).first();
  if (!article) return false;
  await env.DB.batch([
    env.DB.prepare("UPDATE articles SET parent_id = ?, updated_at = ? WHERE parent_id = ? AND owner_id = ?")
      .bind(article.parent_id, new Date().toISOString(), id, identity.id),
    env.DB.prepare("DELETE FROM articles WHERE id = ? AND owner_id = ?").bind(id, identity.id)
  ]);
  if (article.image_key) {
    const usage = await env.DB.prepare("SELECT COUNT(*) AS count FROM articles WHERE image_key = ?")
      .bind(article.image_key).first();
    if (Number(usage?.count) === 0) await deleteImage(env, identity, article.image_key);
  }
  return true;
}

async function importArticles(env, identity, body) {
  const source = Array.isArray(body.articles) ? body.articles : Array.isArray(body.notes) ? body.notes : null;
  if (!source) throw new InputError("Cadangan harus berisi daftar artikel.");
  if (source.length > 300) throw new InputError("Impor dibatasi maksimal 300 artikel per berkas.");
  const ids = source.map((item) => item?.id);
  if (ids.some((id) => typeof id !== "string" || !id || id.length > 100) || new Set(ids).size !== ids.length) {
    throw new InputError("Setiap artikel cadangan harus memiliki ID unik yang valid.");
  }
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM articles WHERE owner_id = ? AND id IN (${placeholders})`
    ).bind(identity.id, ...ids).first();
    if (Number(existing?.count) > 0) {
      throw new InputError("Ada ID artikel yang sudah ada. Ekspor artikel yang ada sebelum menggabungkan berkas ini.");
    }
  }
  const currentRows = await env.DB.prepare("SELECT id, parent_id FROM articles WHERE owner_id = ?")
    .bind(identity.id).all();
  const existingIds = new Set(currentRows.results.map((row) => row.id));
  const importedIds = new Set(ids);
  const normalized = source.map((item) => {
    const input = validateArticleInput({
      ...item,
      visibility: "draft",
      imageKey: ""
    });
    const id = item.id;
    return {
      id,
      ownerId: identity.id,
      slug: `${slugBase(input.title)}-${crypto.randomUUID().slice(0, 8)}`,
      ...input,
      parentId: input.parentId || null
    };
  });
  const importedById = new Map(normalized.map((item) => [item.id, item]));
  let relationCount = 0;
  for (const article of normalized) {
    if (article.relatedIds.includes(article.id)) {
      throw new InputError(`Artikel “${article.title}” tidak boleh terhubung dengan dirinya sendiri.`);
    }
    const references = [article.parentId, ...article.relatedIds].filter(Boolean);
    relationCount += article.relatedIds.length;
    if (relationCount > 1000) throw new InputError("Impor dibatasi maksimal 1.000 hubungan antarartikel.");
    if (references.some((id) => !importedIds.has(id) && !existingIds.has(id))) {
      throw new InputError(`Artikel “${article.title}” terhubung ke artikel yang tidak ditemukan.`);
    }
    let parentId = article.parentId;
    const seen = new Set([article.id]);
    while (parentId && importedById.has(parentId)) {
      if (seen.has(parentId)) throw new InputError("Hubungan parent dalam cadangan membentuk lingkaran.");
      seen.add(parentId);
      parentId = importedById.get(parentId).parentId;
    }
    if (parentId) {
      let existingParent = await env.DB.prepare("SELECT parent_id FROM articles WHERE id = ? AND owner_id = ?")
        .bind(parentId, identity.id).first();
      while (existingParent?.parent_id) {
        if (seen.has(existingParent.parent_id)) throw new InputError("Hubungan parent dalam cadangan membentuk lingkaran.");
        seen.add(existingParent.parent_id);
        existingParent = await env.DB.prepare("SELECT parent_id FROM articles WHERE id = ? AND owner_id = ?")
          .bind(existingParent.parent_id, identity.id).first();
      }
    }
  }

  const now = new Date().toISOString();
  const statements = [];
  for (const article of normalized) {
    statements.push(env.DB.prepare(`
      INSERT INTO articles (
        id, owner_id, slug, title, type, summary, content, visibility,
        parent_id, image_key, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, '', ?, ?, ?)
    `).bind(article.id, identity.id, article.slug, article.title, article.type, article.summary,
      article.content, article.parentId, JSON.stringify(article.tags),
      article.createdAt || now, now));
    for (const targetId of article.relatedIds) {
      statements.push(env.DB.prepare(
        "INSERT INTO article_links (source_id, target_id, created_at) VALUES (?, ?, ?)"
      ).bind(article.id, targetId, now));
    }
  }
  if (statements.length) await env.DB.batch(statements);
  const skippedImages = source.filter((item) => item.imageUrl || item.imageKey).length;
  return { count: normalized.length, skippedImages };
}

async function handleAdmin(request, env, url, method, path) {
  const identity = await getIdentity(request, env);
  const profile = await ensureProfile(env, identity);
  if (path === "/api/admin/session" && method === "GET") return json({ profile });
  if (path === "/api/admin/profile" && method === "PUT") {
    const body = await readJson(request);
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!displayName || displayName.length > 60) return errorResponse("Nama profil wajib diisi (maksimal 60 karakter).");
    await env.DB.prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ?")
      .bind(displayName, new Date().toISOString(), identity.id).run();
    return json({ profile: { ...profile, displayName } });
  }
  if (path === "/api/admin/articles" && method === "GET") return json(await getAdminArticles(env, identity));
  if (path === "/api/admin/articles" && method === "POST") {
    return json(await createArticle(env, identity, await readJson(request)), 201);
  }
  if (path === "/api/admin/images" && method === "POST") {
    return json(await uploadImage(request, env, identity), 201);
  }
  const privateImageMatch = path.match(/^\/api\/admin\/images\/(.+)$/);
  if (privateImageMatch && method === "GET") {
    const key = decodeURIComponent(privateImageMatch[1]);
    const image = await env.DB.prepare("SELECT key FROM image_assets WHERE key = ? AND owner_id = ?")
      .bind(key, identity.id).first();
    return image ? imageResponse(env, key) : new Response("Not found", { status: 404 });
  }
  if (path === "/api/admin/export" && method === "GET") {
    return json({ version: 1, exportedAt: new Date().toISOString(), articles: await getAdminArticles(env, identity) });
  }
  if (path === "/api/admin/import" && method === "POST") {
    return json(await importArticles(env, identity, await readJson(request, 20 * 1024 * 1024)));
  }

  const imageMatch = path.match(/^\/api\/admin\/images\/(.+)$/);
  if (imageMatch && method === "DELETE") {
    const key = decodeURIComponent(imageMatch[1]);
    if (!/^images\/[a-f0-9-]+\.(jpg|png|webp|gif)$/.test(key)) return errorResponse("Gambar tidak valid.");
    return (await deleteImage(env, identity, key)) ? new Response(null, { status: 204 }) : errorResponse("Gambar tidak ditemukan.", 404);
  }
  const articleMatch = path.match(/^\/api\/admin\/articles\/([^/]+)$/);
  if (articleMatch) {
    const id = decodeURIComponent(articleMatch[1]);
    if (method === "PUT") {
      const article = await updateArticle(env, identity, id, await readJson(request));
      return article ? json(article) : errorResponse("Artikel tidak ditemukan.", 404);
    }
    if (method === "DELETE") {
      return (await deleteArticle(env, identity, id))
        ? new Response(null, { status: 204 })
        : errorResponse("Artikel tidak ditemukan.", 404);
    }
  }
  return errorResponse("Endpoint tidak ditemukan.", 404);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (path.startsWith("/api/admin/") || path === "/api/admin") {
    try {
      return await handleAdmin(request, env, url, method, path);
    } catch (error) {
      if (error instanceof Response) return errorResponse(await error.text(), error.status);
      if (error instanceof InputError) return errorResponse(error.message, error.status);
      throw error;
    }
  }
  if (path === "/api/public/articles" && method === "GET") {
    return json(await publicArticles(env, url.searchParams.get("q") || ""));
  }
  if (path.startsWith("/api/")) return errorResponse("Endpoint tidak ditemukan.", 404);
  if (path.startsWith("/article/") && method === "GET") {
    return renderPublicArticle(env, decodeURIComponent(path.slice("/article/".length)));
  }
  if (path.startsWith("/media/") && method === "GET") {
    const key = decodeURIComponent(path.slice("/media/".length));
    if (!/^images\/[a-f0-9-]+\.(jpg|png|webp|gif)$/.test(key)) return new Response("Not found", { status: 404 });
    const isPublished = await env.DB.prepare(
      "SELECT 1 AS found FROM articles WHERE image_key = ? AND visibility = 'published' LIMIT 1"
    ).bind(key).first();
    if (isPublished) {
      return imageResponse(env, key);
    }
    return new Response("Not found", { status: 404 });
  }
  if (method === "GET" || method === "HEAD") return env.ASSETS.fetch(request);
  return errorResponse("Method tidak diizinkan.", 405);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error("Lucimon Library request failed:", error);
      return errorResponse("Terjadi kesalahan server.", 500);
    }
  }
};
