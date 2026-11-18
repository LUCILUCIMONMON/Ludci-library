import { createRemoteJWKSet, jwtVerify } from "jose";
import sanitizeHtml from "sanitize-html";

const ARTICLE_TYPES = new Set(["Dunia", "Karakter", "Alur", "Tempat", "Catatan"]);
const STORY_CATEGORIES = new Set([
  "Canon", "Alternative", "Retelling", "Sidequel", "Spin-off", "Reboot", "Restart", "What if"
]);
const PUBLIC_AUTHOR_ID = "public-contributor";
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const MAX_IMAGE_BYTES = 1024 * 1024;
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

function publicSiteOrigin(env, requestUrl) {
  const origin = env.PUBLIC_SITE_URL ? new URL(env.PUBLIC_SITE_URL) : new URL(requestUrl);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error("PUBLIC_SITE_URL must use HTTP or HTTPS.");
  }
  return origin.origin;
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

  function validateAttributeInput(body, forcedVisibility) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const type = body.type === undefined ? "Catatan" : body.type;
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    const content = sanitizeArticleContent(typeof body.content === "string" ? body.content : "");
    const visibility = forcedVisibility || body.visibility || "draft";
    if (!title || title.length > 120) throw new InputError("Nama entri wajib diisi dan maksimal 120 karakter.");
    if (!ARTICLE_TYPES.has(type)) throw new InputError("Jenis entri tidak valid.");
    if (summary.length > 500) throw new InputError("Ringkasan maksimal 500 karakter.");
    if (content.length > 200000) throw new InputError("Deskripsi maksimal 200.000 karakter.");
    if (!["draft", "published"].includes(visibility)) throw new InputError("Status entri tidak valid.");
    return { title, type, summary, content, visibility };
  }

  async function createAttributeEntry(env, input) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = `${slugBase(input.title)}-${id.slice(0, 8)}`;
    await env.DB.prepare(`
      INSERT INTO attribute_entries (id, slug, title, type, summary, content, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, slug, input.title, input.type, input.summary, input.content, input.visibility, now, now).run();
    return id;
  }

  async function updateAttributeEntry(env, id, input) {
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`
      UPDATE attribute_entries
      SET title = ?, type = ?, summary = ?, content = ?, visibility = ?, updated_at = ?
      WHERE id = ?
    `).bind(input.title, input.type, input.summary, input.content, input.visibility, now, id).run();
    return Number(result.meta?.changes || 0) > 0;
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

function storyCategoriesFromJson(value) {
  try {
    const parsed = JSON.parse(value || '["Canon"]');
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((category) => STORY_CATEGORIES.has(category)))];
    }
  } catch {
    console.warn("Invalid story_categories_json found for an article.");
  }
  return ["Canon"];
}

function articleFromRow(row, admin = false) {
  let tags = [];
  try {
    const parsed = JSON.parse(row.tags_json || "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((tag) => typeof tag === "string");
  } catch {
    console.warn("Invalid tags_json found for an article.");
  }
  const storyCategories = storyCategoriesFromJson(row.story_categories_json);
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
    mainStoryId: row.main_story_id || "",
    mainStorySlug: row.main_story_slug || "",
    mainStoryTitle: row.main_story_title || "",
    storyCategories,
    isHiddenStory: Number(row.is_hidden_story) === 1,
    relations: row.relations || (row.relatedIds || []).map((targetId) => ({ targetId, label: "terkait" })),
    relatedIds: row.relations
      ? row.relations.map((relation) => relation.targetId)
      : row.relatedIds || [],
    relatedArticles: row.relatedArticles || [],
    attributes: row.attributes || [],
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

async function validateRelations(env, identity, articleId, parentId, relations, mainStoryId = "") {
  if (parentId) {
    if (parentId === articleId) throw new InputError("Artikel tidak bisa menjadi parent untuk dirinya sendiri.");
    let currentId = parentId;
    const seen = new Set();
    while (currentId) {
      if (currentId === articleId || seen.has(currentId)) {
        throw new InputError("Hubungan parent tidak boleh membentuk lingkaran.");
      }
      seen.add(currentId);
      const current = await env.DB.prepare("SELECT parent_id FROM articles WHERE id = ? AND owner_id IN (?, ?)")
        .bind(currentId, identity.id, PUBLIC_AUTHOR_ID).first();
      if (!current) throw new InputError("Artikel parent tidak ditemukan.");
      currentId = current.parent_id || "";
    }
  }

  if (relations.length > 100) throw new InputError("Pilih maksimal 100 hubungan cerita.");
  if (relations.some((relation) => relation.targetId === articleId)) {
    throw new InputError("Cerita tidak bisa terhubung dengan dirinya sendiri.");
  }
  if (relations.length) {
    const placeholders = relations.map(() => "?").join(",");
    const publicContributor = identity.id === PUBLIC_AUTHOR_ID;
    const statement = publicContributor
      ? `SELECT COUNT(*) AS count FROM articles WHERE visibility = 'published' AND id IN (${placeholders})`
      : `SELECT COUNT(*) AS count FROM articles WHERE owner_id IN (?, ?) AND id IN (${placeholders})`;
    const bindings = publicContributor
      ? relations.map((relation) => relation.targetId)
      : [identity.id, PUBLIC_AUTHOR_ID, ...relations.map((relation) => relation.targetId)];
    const result = await env.DB.prepare(statement).bind(...bindings).first();
    if (Number(result?.count) !== relations.length) {
      throw new InputError("Satu atau beberapa cerita yang dihubungkan tidak ditemukan atau belum terbit.");
    }
  }
  if (mainStoryId) {
    if (mainStoryId === articleId) throw new InputError("Cerita tidak bisa menjadi cerita utama untuk dirinya sendiri.");
    const publicContributor = identity.id === PUBLIC_AUTHOR_ID;
    const statement = publicContributor
      ? "SELECT id FROM articles WHERE id = ? AND visibility = 'published'"
      : "SELECT id FROM articles WHERE id = ? AND owner_id IN (?, ?)";
    const bindings = publicContributor ? [mainStoryId] : [mainStoryId, identity.id, PUBLIC_AUTHOR_ID];
    const mainStory = await env.DB.prepare(statement).bind(...bindings).first();
    if (!mainStory) throw new InputError("Cerita utama tidak ditemukan atau belum diterbitkan.");
  }
  return relations;
}

function validateArticleInput(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const type = body.type === undefined ? "Catatan" : body.type;
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const content = sanitizeArticleContent(typeof body.content === "string" ? body.content : "");
  const visibility = body.visibility === undefined ? "draft" : body.visibility;
  const parentId = typeof body.parentId === "string" ? body.parentId : "";
  if (body.mainStoryId !== undefined && typeof body.mainStoryId !== "string") {
    throw new InputError("Cerita utama tidak valid.");
  }
  const mainStoryId = typeof body.mainStoryId === "string" ? body.mainStoryId.trim() : "";
  const storyCategories = body.storyCategories === undefined
    ? ["Canon"]
    : Array.isArray(body.storyCategories)
      ? [...new Set(body.storyCategories.filter((category) => typeof category === "string").map((category) => category.trim()))]
      : null;
  const isHiddenStory = body.isHiddenStory === undefined ? false : body.isHiddenStory;
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))]
    : [];
  if (body.relations !== undefined && !Array.isArray(body.relations)) {
    throw new InputError("Daftar hubungan cerita tidak valid.");
  }
  const relationSource = Array.isArray(body.relations)
    ? body.relations
    : Array.isArray(body.relatedIds)
      ? body.relatedIds.map((targetId) => ({ targetId, label: "terkait" }))
      : [];
  const relationTargets = new Set();
  const relations = relationSource.map((item) => {
    const targetId = typeof item?.targetId === "string" ? item.targetId.trim() : "";
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!targetId || targetId.length > 100) throw new InputError("Cerita tujuan hubungan tidak valid.");
    if (label.length > 60) throw new InputError("Label hubungan maksimal 60 karakter.");
    if (relationTargets.has(targetId)) throw new InputError("Satu cerita hanya boleh dipilih sekali pada daftar hubungan.");
    relationTargets.add(targetId);
    return { targetId, label: label || "terkait" };
  });
  if (body.attributes !== undefined && !Array.isArray(body.attributes)) {
    throw new InputError("Daftar atribut cerita tidak valid.");
  }
  const attributes = [];
  const attributeIds = new Set();
  for (const item of Array.isArray(body.attributes) ? body.attributes : []) {
    if (typeof item?.id === "string") {
      const id = item.id.trim();
      if (!id || id.length > 100 || attributeIds.has(id)) {
        throw new InputError("Atribut cerita tidak valid atau dipilih lebih dari sekali.");
      }
      attributeIds.add(id);
      attributes.push({ id });
      continue;
    }

    const legacyName = typeof item?.name === "string" ? item.name.trim() : "";
    const legacyValue = typeof item?.value === "string" ? item.value.trim() : "";
    const title = typeof item?.title === "string" ? item.title.trim() : legacyValue;
    const type = item?.type === undefined ? "Catatan" : item.type;
    const summary = typeof item?.summary === "string"
      ? item.summary.trim()
      : legacyName ? `Atribut lama: ${legacyName}` : "";
    const content = sanitizeArticleContent(typeof item?.content === "string" ? item.content : "");
    if (!title || title.length > 120 || !ARTICLE_TYPES.has(type)) {
      throw new InputError("Setiap atribut harus memiliki judul dan jenis entri yang valid.");
    }
    if (summary.length > 500 || content.length > 200000) {
      throw new InputError("Ringkasan atribut maksimal 500 karakter dan deskripsinya maksimal 200.000 karakter.");
    }
    attributes.push({ title, type, summary, content });
  }
  if (attributes.length > 50) throw new InputError("Maksimal 50 atribut per cerita.");
  if (relations.length > 100) throw new InputError("Pilih maksimal 100 hubungan cerita.");
  const imageKey = typeof body.imageKey === "string" ? body.imageKey : "";

  if (!storyCategories || !storyCategories.length || storyCategories.length > STORY_CATEGORIES.size
    || storyCategories.some((category) => !STORY_CATEGORIES.has(category))) {
    throw new InputError("Pilih setidaknya satu kategori cerita yang valid.");
  }
  if (body.isHiddenStory !== undefined && typeof isHiddenStory !== "boolean") {
    throw new InputError("Status cerita tersembunyi tidak valid.");
  }
  if (mainStoryId.length > 100) throw new InputError("Cerita utama tidak valid.");
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
  return {
    title, type, summary, content, visibility, parentId, mainStoryId, storyCategories, isHiddenStory, tags,
    relations, relatedIds: relations.map((relation) => relation.targetId), attributes, imageKey
  };
}

async function resolveAttributeEntries(env, identity, attributes) {
  const result = [];
  const resolvedIds = new Set();
  const newEntriesByDefinition = new Map();
  for (const attribute of attributes) {
    if (attribute.id) {
      const publicContributor = identity.id === PUBLIC_AUTHOR_ID;
      const statement = publicContributor
        ? `SELECT e.id, e.slug, e.title, e.type, e.summary, e.content
           FROM attribute_entries e
           WHERE e.id = ? AND e.visibility = 'published'`
        : "SELECT id, slug, title, type, summary, content FROM attribute_entries WHERE id = ?";
      const entry = await env.DB.prepare(statement).bind(attribute.id).first();
      if (!entry) throw new InputError("Atribut tidak ditemukan atau belum diterbitkan.");
      if (!resolvedIds.has(entry.id)) {
        result.push({ ...entry, isNew: false });
        resolvedIds.add(entry.id);
      }
      continue;
    }
    const definition = JSON.stringify([attribute.title, attribute.type, attribute.summary, attribute.content]);
    let entry = newEntriesByDefinition.get(definition);
    if (!entry) {
      const publicContributor = identity.id === PUBLIC_AUTHOR_ID;
      const statement = publicContributor
        ? `SELECT e.id, e.slug, e.title, e.type, e.summary, e.content
           FROM attribute_entries e
           WHERE e.title = ? AND e.type = ? AND e.summary = ? AND e.content = ?
             AND e.visibility = 'published'
           LIMIT 1`
        : `SELECT id, slug, title, type, summary, content
           FROM attribute_entries
           WHERE title = ? AND type = ? AND summary = ? AND content = ?
           LIMIT 1`;
      entry = await env.DB.prepare(statement)
        .bind(attribute.title, attribute.type, attribute.summary, attribute.content).first();
      if (entry) {
        entry = { ...entry, isNew: false };
      } else {
        const id = crypto.randomUUID();
        entry = {
          ...attribute,
          id,
          slug: `${slugBase(attribute.title)}-${id.slice(0, 8)}`,
          isNew: true
        };
      }
      newEntriesByDefinition.set(definition, entry);
    }
    if (!resolvedIds.has(entry.id)) {
      result.push(entry);
      resolvedIds.add(entry.id);
    }
  }
  return result;
}

async function assertOwnedImage(env, identity, imageKey) {
  if (!imageKey) return;
  const row = await env.DB.prepare("SELECT key FROM image_assets WHERE key = ? AND owner_id = ?")
    .bind(imageKey, identity.id).first();
  if (!row) throw new InputError("Gambar tidak ditemukan atau bukan milik akun ini.");
}

async function getArticle(env, identity, id) {
  const row = await env.DB.prepare(`
    SELECT a.*, p.slug AS parent_slug, p.title AS parent_title,
      m.slug AS main_story_slug, m.title AS main_story_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id
    LEFT JOIN articles m ON m.id = a.main_story_id
    WHERE a.id = ? AND a.owner_id = ?
  `).bind(id, identity.id).first();
  if (!row) return null;
  const [links, attributes] = await Promise.all([
    env.DB.prepare("SELECT target_id, relation_label FROM article_links WHERE source_id = ? ORDER BY target_id")
      .bind(id).all(),
    env.DB.prepare(`
      SELECT e.id, e.slug, e.title, e.type, e.summary, e.content, e.visibility
      FROM story_attribute_links l
      JOIN attribute_entries e ON e.id = l.attribute_id
      WHERE l.story_id = ? ORDER BY e.type, e.title
    `)
      .bind(id).all()
  ]);
  return articleFromRow({
    ...row,
    relations: links.results.map((link) => ({ targetId: link.target_id, label: link.relation_label })),
    attributes: attributes.results
  }, true);
}

async function getPublishedArticle(env, id) {
  const row = await env.DB.prepare(`
    SELECT a.*,
      p.slug AS parent_slug, p.title AS parent_title,
      m.slug AS main_story_slug, m.title AS main_story_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id AND p.visibility = 'published'
    LEFT JOIN articles m ON m.id = a.main_story_id AND m.visibility = 'published'
    WHERE (a.id = ? OR a.slug = ?) AND a.visibility = 'published'
  `).bind(id, id).first();
  if (!row) return null;
  const [links, attributes] = await Promise.all([
    env.DB.prepare(`
      SELECT l.target_id, l.relation_label, target.slug, target.title, target.type, target.summary
      FROM article_links l
      JOIN articles target ON target.id = l.target_id AND target.visibility = 'published'
      WHERE l.source_id = ?
      ORDER BY target.title
    `).bind(row.id).all(),
    env.DB.prepare(`
      SELECT e.id, e.slug, e.title, e.type, e.summary
      FROM story_attribute_links l
      JOIN attribute_entries e ON e.id = l.attribute_id AND e.visibility = 'published'
      WHERE l.story_id = ?
      ORDER BY e.type, e.title
    `).bind(row.id).all()
  ]);
  return articleFromRow({
    ...row,
    parent_id: row.parent_id && row.parent_slug ? row.parent_id : "",
    main_story_id: row.main_story_id && row.main_story_slug ? row.main_story_id : "",
    relations: links.results.map((link) => ({ targetId: link.target_id, label: link.relation_label })),
    relatedArticles: links.results.map((link) => ({
      id: link.target_id,
      slug: link.slug,
      title: link.title,
      type: link.type,
      summary: link.summary,
      relation: link.relation_label
    })),
    attributes: attributes.results
  });
}

async function getAdminArticles(env, identity) {
  const result = await env.DB.prepare(`
    SELECT a.*, p.slug AS parent_slug, p.title AS parent_title,
      m.slug AS main_story_slug, m.title AS main_story_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id
    LEFT JOIN articles m ON m.id = a.main_story_id
    WHERE a.owner_id IN (?, ?)
    ORDER BY a.updated_at DESC
  `).bind(identity.id, PUBLIC_AUTHOR_ID).all();
  const [links, attributes] = await Promise.all([
    env.DB.prepare(`
    SELECT l.source_id, l.target_id, l.relation_label
    FROM article_links l
    JOIN articles a ON a.id = l.source_id
    WHERE a.owner_id IN (?, ?)
  `).bind(identity.id, PUBLIC_AUTHOR_ID).all(),
    env.DB.prepare(`
      SELECT l.story_id, e.id, e.slug, e.title, e.type, e.summary, e.content, e.visibility
      FROM story_attribute_links l
      JOIN attribute_entries e ON e.id = l.attribute_id
      JOIN articles a ON a.id = l.story_id
      WHERE a.owner_id IN (?, ?)
      ORDER BY e.type, e.title
    `).bind(identity.id, PUBLIC_AUTHOR_ID).all()
  ]);
  const relationsBySource = new Map();
  for (const link of links.results) {
    const relations = relationsBySource.get(link.source_id) || [];
    relations.push({ targetId: link.target_id, label: link.relation_label });
    relationsBySource.set(link.source_id, relations);
  }
  const attributesByArticle = new Map();
  for (const attribute of attributes.results) {
    const values = attributesByArticle.get(attribute.story_id) || [];
    values.push(attribute);
    attributesByArticle.set(attribute.story_id, values);
  }
  return result.results.map((row) => articleFromRow({
    ...row,
    relations: relationsBySource.get(row.id) || [],
    attributes: attributesByArticle.get(row.id) || []
  }, true));
}

async function publicArticles(env, query) {
  const needle = query.trim().slice(0, 100);
  const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await env.DB.prepare(`
    SELECT a.id, a.slug, a.title, a.type, a.summary, a.visibility, a.story_categories_json,
      a.is_hidden_story,
      CASE WHEN main.id IS NOT NULL THEN a.main_story_id ELSE NULL END AS main_story_id,
      main.slug AS main_story_slug, main.title AS main_story_title,
      CASE WHEN p.id IS NOT NULL THEN a.parent_id ELSE NULL END AS parent_id,
      a.image_key, a.tags_json, a.created_at, a.updated_at,
      p.slug AS parent_slug, p.title AS parent_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id AND p.visibility = 'published'
    LEFT JOIN articles main ON main.id = a.main_story_id AND main.visibility = 'published'
    WHERE a.visibility = 'published'
      AND (? = '' OR a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\'
        OR a.content LIKE ? ESCAPE '\\' OR a.tags_json LIKE ? ESCAPE '\\')
    ORDER BY a.updated_at DESC
  `).bind(needle, pattern, pattern, pattern, pattern).all();
  if (!rows.results.length) return [];
  const ids = rows.results.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const [links, attributes] = await Promise.all([
    env.DB.prepare(`
      SELECT l.source_id, l.target_id, l.relation_label
      FROM article_links l
      JOIN articles target ON target.id = l.target_id AND target.visibility = 'published'
      WHERE l.source_id IN (${placeholders})
    `).bind(...ids).all(),
    env.DB.prepare(`
      SELECT l.story_id, e.id, e.slug, e.title, e.type, e.summary
      FROM story_attribute_links l
      JOIN attribute_entries e ON e.id = l.attribute_id AND e.visibility = 'published'
      WHERE l.story_id IN (${placeholders})
      ORDER BY e.type, e.title
    `).bind(...ids).all()
  ]);
  const relationsBySource = new Map();
  for (const link of links.results) {
    const relations = relationsBySource.get(link.source_id) || [];
    relations.push({ targetId: link.target_id, label: link.relation_label });
    relationsBySource.set(link.source_id, relations);
  }
  const attributesByArticle = new Map();
  for (const attribute of attributes.results) {
    const values = attributesByArticle.get(attribute.story_id) || [];
    values.push(attribute);
    attributesByArticle.set(attribute.story_id, values);
  }
  return rows.results.map((row) => articleFromRow({
    ...row,
    relations: relationsBySource.get(row.id) || [],
    attributes: attributesByArticle.get(row.id) || []
  }));
}

function attributeEntryFromRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    summary: row.summary,
    ...(row.content !== undefined ? { content: row.content } : {}),
    ...(row.visibility !== undefined ? { visibility: row.visibility } : {}),
    ...(row.created_at !== undefined ? { createdAt: row.created_at } : {}),
    ...(row.updated_at !== undefined ? { updatedAt: row.updated_at } : {}),
    storyCount: Number(row.story_count || 0)
  };
}

async function getPublicAttributeEntries(env) {
  const result = await env.DB.prepare(`
    SELECT e.id, e.slug, e.title, e.type, e.summary, e.visibility, e.created_at, e.updated_at,
      COUNT(DISTINCT s.id) AS story_count
    FROM attribute_entries e
    LEFT JOIN story_attribute_links l ON l.attribute_id = e.id
    LEFT JOIN articles s ON s.id = l.story_id AND s.visibility = 'published'
    WHERE e.visibility = 'published'
    GROUP BY e.id
    ORDER BY e.type, e.title
  `).all();
  return result.results.map(attributeEntryFromRow);
}

async function getAdminAttributeEntries(env) {
  const result = await env.DB.prepare(`
    SELECT e.id, e.slug, e.title, e.type, e.summary, e.content, e.visibility, e.created_at, e.updated_at,
      COUNT(DISTINCT l.story_id) AS story_count
    FROM attribute_entries e
    LEFT JOIN story_attribute_links l ON l.attribute_id = e.id
    GROUP BY e.id
    ORDER BY e.type, e.title
    LIMIT 1000
  `).all();
  return result.results.map(attributeEntryFromRow);
}

async function getPublicAttribute(env, slug) {
  const attribute = await env.DB.prepare(`
    SELECT e.id, e.slug, e.title, e.type, e.summary, e.content, e.visibility, e.created_at, e.updated_at
    FROM attribute_entries e
    WHERE e.slug = ? AND e.visibility = 'published'
  `).bind(slug).first();
  if (!attribute) return null;
  const stories = await env.DB.prepare(`
    SELECT s.id, s.slug, s.title, s.type, s.summary, s.updated_at
    FROM story_attribute_links l
    JOIN articles s ON s.id = l.story_id AND s.visibility = 'published'
    WHERE l.attribute_id = ?
    ORDER BY s.title
  `).bind(attribute.id).all();
  return {
    ...attributeEntryFromRow(attribute),
    content: attribute.content,
    stories: stories.results
  };
}

function validateAttributeInput(body, forcedVisibility) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const type = body.type === undefined ? "Catatan" : body.type;
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const content = sanitizeArticleContent(typeof body.content === "string" ? body.content : "");
  const visibility = forcedVisibility || body.visibility || "draft";
  if (!title || title.length > 120) throw new InputError("Nama entri wajib diisi dan maksimal 120 karakter.");
  if (!ARTICLE_TYPES.has(type)) throw new InputError("Jenis entri tidak valid.");
  if (summary.length > 500) throw new InputError("Ringkasan maksimal 500 karakter.");
  if (content.length > 200000) throw new InputError("Deskripsi maksimal 200.000 karakter.");
  if (!["draft", "published"].includes(visibility)) throw new InputError("Status entri tidak valid.");
  return { title, type, summary, content, visibility };
}

async function createAttributeEntry(env, input) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = `${slugBase(input.title)}-${id.slice(0, 8)}`;
  await env.DB.prepare(`
    INSERT INTO attribute_entries (id, slug, title, type, summary, content, visibility, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, slug, input.title, input.type, input.summary, input.content, input.visibility, now, now).run();
  return id;
}

async function updateAttributeEntry(env, id, input) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE attribute_entries
    SET title = ?, type = ?, summary = ?, content = ?, visibility = ?, updated_at = ?
    WHERE id = ?
  `).bind(input.title, input.type, input.summary, input.content, input.visibility, now, id).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function deleteAttributeEntry(env, id) {
  const result = await env.DB.prepare("DELETE FROM attribute_entries WHERE id = ?").bind(id).run();
  return Number(result.meta?.changes || 0) > 0;
}

function pageResponse(title, description, body, status = 200, metadata = {}) {
  const robots = metadata.robots || (status >= 400 ? "noindex, follow" : "index, follow");
  const canonical = metadata.canonicalUrl
    ? `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}">`
    : "";
  const structuredData = metadata.structuredData
    ? `<script type="application/ld+json">${JSON.stringify(metadata.structuredData).replace(/</g, "\\u003c")}</script>`
    : "";
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${metadata.type === "article" ? "article" : "website"}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${metadata.canonicalUrl ? `<meta property="og:url" content="${escapeHtml(metadata.canonicalUrl)}">` : ""}
  <meta name="theme-color" content="#f5f8fc">
  <title>${escapeHtml(title)} · Lucimon Library</title>
  ${canonical}
  ${structuredData}
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
        <a class="nav-link" href="/guide">Panduan</a>
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
      "X-Robots-Tag": robots,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'"
    }
  });
}

function textContentHtml(content) {
  const safeContent = sanitizeArticleContent(content);
  return safeContent || '<p class="relation-empty">Artikel ini belum memiliki isi.</p>';
}

async function renderPublicArticle(env, slug, requestUrl) {
  const article = await env.DB.prepare(`
    SELECT a.*, p.slug AS parent_slug, p.title AS parent_title,
      main.slug AS main_story_slug, main.title AS main_story_title
    FROM articles a
    LEFT JOIN articles p ON p.id = a.parent_id AND p.visibility = 'published'
    LEFT JOIN articles main ON main.id = a.main_story_id AND main.visibility = 'published'
    WHERE a.slug = ? AND a.visibility = 'published'
  `).bind(slug).first();
  if (!article) return pageResponse("Artikel tidak ditemukan", "Artikel publik tidak ditemukan.", `
    <div class="not-found"><h1>Artikel tidak ditemukan</h1><p>Artikel ini mungkin belum diterbitkan atau sudah dihapus.</p><a class="back-link" href="/">← Kembali ke beranda</a></div>
  `, 404);

  const [childrenResult, mainStoryChildrenResult, relatedResult, incomingResult, attributesResult, playlistsResult] = await Promise.all([
    env.DB.prepare("SELECT id, slug, title, type FROM articles WHERE parent_id = ? AND visibility = 'published' ORDER BY title")
      .bind(article.id).all(),
    env.DB.prepare(`
      SELECT id, slug, title, type, story_categories_json, is_hidden_story
      FROM articles WHERE main_story_id = ? AND visibility = 'published'
      ORDER BY title
    `).bind(article.id).all(),
    env.DB.prepare(`
      SELECT a.id, a.slug, a.title, a.type, l.relation_label
      FROM article_links l JOIN articles a ON a.id = l.target_id
      WHERE l.source_id = ? AND a.visibility = 'published'
      ORDER BY a.title
    `).bind(article.id).all(),
    env.DB.prepare(`
      SELECT a.id, a.slug, a.title, a.type, l.relation_label
      FROM article_links l JOIN articles a ON a.id = l.source_id
      WHERE l.target_id = ? AND a.visibility = 'published'
      ORDER BY a.title
    `).bind(article.id).all(),
    env.DB.prepare(`
      SELECT e.slug, e.title, e.type
      FROM story_attribute_links l
      JOIN attribute_entries e ON e.id = l.attribute_id AND e.visibility = 'published'
      WHERE l.story_id = ? ORDER BY e.type, e.title
    `)
      .bind(article.id).all(),
    env.DB.prepare(`
      SELECT p.slug, p.title
      FROM playlists p JOIN playlist_items i ON i.playlist_id = p.id
      WHERE i.article_id = ?
      ORDER BY p.title
    `).bind(article.id).all()
  ]);
  const linkedArticle = (row, label = "") => `<a class="relation-link" href="/article/${encodeURIComponent(row.slug)}"><span>${escapeHtml(row.title)}</span><small>${escapeHtml(label || row.type)} →</small></a>`;
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
    ? relatedResult.results.map((row) => linkedArticle(row, row.relation_label)).join("")
    : '<div class="relation-empty">Belum ada hubungan keluar.</div>';
  const incoming = incomingResult.results.length
    ? incomingResult.results.map((row) => linkedArticle(row, `${row.relation_label} · menuju cerita ini`)).join("")
    : '<div class="relation-empty">Belum ada cerita yang menghubungkan ke sini.</div>';
  const children = childrenResult.results.length
    ? childrenResult.results.map(linkedArticle).join("")
    : '<div class="relation-empty">Belum ada turunan yang diterbitkan.</div>';
  const mainStoryChildren = mainStoryChildrenResult.results.length
    ? mainStoryChildrenResult.results.map((row) => {
      let categories = ["Canon"];
      categories = storyCategoriesFromJson(row.story_categories_json);
      const labels = [...categories, ...(row.is_hidden_story ? ["Cerita tersembunyi · lore rahasia"] : [])].join(" · ");
      return linkedArticle(row, labels);
    }).join("")
    : '<div class="relation-empty">Belum ada cerita yang memilih ini sebagai cerita utama.</div>';
  const attributes = attributesResult.results.length
    ? attributesResult.results.map((attribute) => {
      const href = `/attribute/${encodeURIComponent(attribute.slug)}`;
      return `<a class="relation-link" href="${escapeHtml(href)}"><span>${escapeHtml(attribute.title)}</span><small>${escapeHtml(attribute.type)} · Buka atribut →</small></a>`;
    }).join("")
    : '<div class="relation-empty">Belum ada entri atribut.</div>';
  const playlists = playlistsResult.results.length
    ? playlistsResult.results.map((playlist) => `<a class="relation-link" href="/#/playlist/${encodeURIComponent(playlist.slug)}"><span>${escapeHtml(playlist.title)}</span><small>Buka playlist →</small></a>`).join("")
    : '<div class="relation-empty">Cerita ini belum masuk playlist.</div>';
  const body = `
    <nav class="detail-breadcrumb" aria-label="Jejak navigasi"><a href="/">Beranda</a><span>/</span><span>${escapeHtml(article.title)}</span></nav>
    <article>
      ${image}
      <header class="detail-header">
        <span class="type-pill type-${escapeHtml(article.type.toLowerCase())}">${escapeHtml(article.type)}</span>
        <div class="detail-tags story-category-tags">
          ${storyCategoriesFromJson(article.story_categories_json).map((category) => `<span class="tag">${escapeHtml(category)}</span>`).join("")}
          ${article.is_hidden_story ? '<span class="tag hidden-story-tag">Cerita tersembunyi · lore rahasia</span>' : ""}
        </div>
        <h1>${escapeHtml(article.title)}</h1>
        ${article.summary ? `<p class="detail-summary">${escapeHtml(article.summary)}</p>` : ""}
        <div class="eyebrow">DIPERBARUI ${escapeHtml(new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(article.updated_at)).toLocaleUpperCase("id"))}</div>
        <div class="detail-actions">
          <a class="button button-quiet" href="/#/edit/${encodeURIComponent(article.id)}">Ubah artikel</a>
          <a class="button button-quiet" href="/#/delete/${encodeURIComponent(article.id)}">Hapus artikel</a>
        </div>
      </header>
      <div class="detail-content">${textContentHtml(article.content)}</div>
      ${tags.length ? `<div class="detail-tags">${tags.map((tag) => `<span class="tag"># ${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <section class="relation-grid" aria-label="Relasi cerita">
        <div class="relation-panel"><h3>Bagian dari</h3>${parent}</div>
        <div class="relation-panel"><h3>Turunan · ${childrenResult.results.length}</h3>${children}</div>
        <div class="relation-panel"><h3>Cerita utama</h3>${article.main_story_slug
          ? `<a class="relation-link" href="/article/${encodeURIComponent(article.main_story_slug)}"><span>${escapeHtml(article.main_story_title)}</span><small>Cerita utama yang terkait →</small></a>`
          : '<div class="relation-empty">Tidak ditautkan ke cerita utama tertentu.</div>'}</div>
        <div class="relation-panel"><h3>Cerita yang terkait ke sini · ${mainStoryChildrenResult.results.length}</h3>${mainStoryChildren}</div>
        <div class="relation-panel"><h3>Hubungan dari cerita ini</h3>${related}</div>
        <div class="relation-panel"><h3>Terhubung dari cerita lain</h3>${incoming}</div>
        <div class="relation-panel"><h3>Artikel atribut yang ditautkan</h3><div class="relation-list">${attributes}</div></div>
        <div class="relation-panel"><h3>Playlist</h3>${playlists}</div>
      </section>
    </article>
    <a class="back-link" href="/">← Kembali ke beranda</a>`;
  const canonicalUrl = new URL(`/article/${encodeURIComponent(article.slug)}`, publicSiteOrigin(env, requestUrl)).href;
  return pageResponse(article.title, article.summary || article.title, body, 200, {
    canonicalUrl,
    type: "article",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.summary || article.title,
      datePublished: article.created_at,
      dateModified: article.updated_at,
      mainEntityOfPage: canonicalUrl,
      articleSection: article.type
    }
  });
}

async function renderPublicAttribute(env, slug, requestUrl) {
  const attribute = await getPublicAttribute(env, slug);
  if (!attribute) {
    return pageResponse("Artikel tidak ditemukan", "Artikel atribut publik tidak ditemukan.", `
      <div class="not-found"><h1>Artikel tidak ditemukan</h1><p>Artikel ini mungkin belum diterbitkan atau sudah dihapus.</p><a class="back-link" href="/">← Kembali ke beranda</a></div>
    `, 404);
  }
  const stories = attribute.stories.length
    ? `<div class="note-grid">${attribute.stories.map((story) => `
        <article class="note-card"><a class="note-card-main" href="/article/${encodeURIComponent(story.slug)}">
          <div class="card-top"><span class="type-pill type-${escapeHtml(story.type.toLowerCase())}">${escapeHtml(story.type)}</span></div>
          <h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.summary || "Buka cerita untuk membaca detail.")}</p>
        </a></article>`).join("")}</div>`
    : '<div class="empty-state"><h3>Artikel mandiri</h3><p>Belum ada cerita yang ditautkan. Artikel ini tetap dapat dibaca dan diterbitkan secara mandiri.</p></div>';
  const body = `
    <nav class="detail-breadcrumb" aria-label="Jejak navigasi"><a href="/">Beranda</a><span>/</span><span>Atribut</span><span>/</span><span>${escapeHtml(attribute.title)}</span></nav>
    <article class="attribute-detail">
      <header class="detail-header">
        <span class="type-pill type-${escapeHtml(attribute.type.toLowerCase())}">${escapeHtml(attribute.type)}</span>
        <h1>${escapeHtml(attribute.title)}</h1>
        ${attribute.summary ? `<p class="detail-summary">${escapeHtml(attribute.summary)}</p>` : ""}
        <div class="eyebrow">DIPERBARUI ${escapeHtml(new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(attribute.updatedAt)).toLocaleUpperCase("id"))}</div>
      </header>
      <div class="detail-content">${textContentHtml(attribute.content)}</div>
      <section>
        <div class="section-heading"><h2>Cerita yang ditautkan</h2><span class="result-count">${attribute.stories.length} cerita</span></div>
        ${stories}
      </section>
    </article>
    <a class="back-link" href="/">← Kembali ke beranda</a>`;
  const canonicalUrl = new URL(`/attribute/${encodeURIComponent(attribute.slug)}`, publicSiteOrigin(env, requestUrl)).href;
  return pageResponse(attribute.title, attribute.summary || attribute.title, body, 200, {
    canonicalUrl,
    type: "article",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: attribute.title,
      description: attribute.summary || attribute.title,
      datePublished: attribute.createdAt,
      dateModified: attribute.updatedAt,
      mainEntityOfPage: canonicalUrl,
      articleSection: attribute.type
    }
  });
}

async function renderPublicArticleCatalog(env, requestUrl) {
  const [articles, attributes] = await Promise.all([
    env.DB.prepare(`
      SELECT slug, title, type, summary, updated_at
      FROM articles
      WHERE visibility = 'published'
      ORDER BY updated_at DESC, title
    `).all(),
    env.DB.prepare(`
      SELECT slug, title, type, summary, updated_at
      FROM attribute_entries
      WHERE visibility = 'published'
      ORDER BY updated_at DESC, title
    `).all()
  ]);
  const origin = publicSiteOrigin(env, requestUrl);
  const entryList = (entries, route) => entries.length
    ? `<ul class="public-catalog-list">${entries.map((entry) => `
        <li>
          <a href="${new URL(`/${route}/${encodeURIComponent(entry.slug)}`, origin).href}">
            <span class="type-pill">${escapeHtml(entry.type)}</span>
            <strong>${escapeHtml(entry.title)}</strong>
            ${entry.summary ? `<span>${escapeHtml(entry.summary)}</span>` : ""}
          </a>
          <time datetime="${escapeHtml(entry.updated_at)}">Diperbarui ${escapeHtml(entry.updated_at)}</time>
        </li>`).join("")}</ul>`
    : '<p class="relation-empty">Belum ada artikel publik.</p>';
  return `<div class="page-heading">
      <div><div class="eyebrow">LUCIMON LIBRARY · ARTIKEL PUBLIK</div><h1>Jelajahi semua artikel</h1><p>Daftar cerita dan atribut terbit, dapat dibuka tanpa JavaScript maupun login.</p></div>
    </div>
    <section aria-labelledby="public-stories-heading">
      <div class="section-heading"><h2 id="public-stories-heading">Cerita</h2><span class="result-count">${articles.results.length} artikel</span></div>
      ${entryList(articles.results, "article")}
    </section>
    <section aria-labelledby="public-attributes-heading">
      <div class="section-heading"><h2 id="public-attributes-heading">Atribut</h2><span class="result-count">${attributes.results.length} artikel</span></div>
      ${entryList(attributes.results, "attribute")}
    </section>`;
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
  const relations = await validateRelations(env, identity, id, input.parentId, input.relations, input.mainStoryId);
  const attributes = await resolveAttributeEntries(env, identity, input.attributes);
  await assertOwnedImage(env, identity, input.imageKey);
  const slug = `${slugBase(input.title)}-${id.slice(0, 8)}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO articles (
        id, owner_id, slug, title, type, summary, content, visibility,
        parent_id, image_key, tags_json, story_categories_json, is_hidden_story, main_story_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, identity.id, slug, input.title, input.type, input.summary,
      input.content, input.visibility, parentId, input.imageKey, JSON.stringify(input.tags),
      JSON.stringify(input.storyCategories), input.isHiddenStory ? 1 : 0, input.mainStoryId || null, now, now),
    ...relations.map(({ targetId, label }) => env.DB.prepare(
      "INSERT INTO article_links (source_id, target_id, relation_label, created_at) VALUES (?, ?, ?, ?)"
    ).bind(id, targetId, label, now)),
    ...attributes.filter((attribute) => attribute.isNew).map((attribute) => env.DB.prepare(`
      INSERT INTO attribute_entries (id, slug, title, type, summary, content, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(attribute.id, attribute.slug, attribute.title, attribute.type, attribute.summary, attribute.content, input.visibility, now, now)),
    ...attributes.map((attribute) => env.DB.prepare(`
      INSERT INTO story_attribute_links (story_id, attribute_id, created_at)
      VALUES (?, ?, ?)
    `).bind(id, attribute.id, now))
  ];
  await env.DB.batch(statements);
  return getArticle(env, identity, id);
}

async function createPublicArticle(env, body) {
  const input = validateArticleInput({
    ...body,
    visibility: "published",
    parentId: "",
    imageKey: ""
  });
  const identity = {
    id: PUBLIC_AUTHOR_ID,
    email: "public-contributor@lucimon.invalid",
    name: "Kontributor publik"
  };
  await ensureProfile(env, identity);
  return createArticle(env, identity, input);
}

async function updatePublishedArticle(env, id, body) {
  const existing = await env.DB.prepare(
    "SELECT id, main_story_id FROM articles WHERE id = ? AND visibility = 'published'"
  ).bind(id).first();
  if (!existing) return null;
  const identity = {
    id: PUBLIC_AUTHOR_ID,
    email: "public-contributor@lucimon.invalid",
    name: "Kontributor publik"
  };
  const input = validateArticleInput({
    ...body,
    title: body.title,
    type: body.type,
    summary: body.summary,
    content: body.content,
    visibility: "published",
    parentId: "",
    imageKey: ""
  });
  const relations = await validateRelations(env, identity, id, "", input.relations, input.mainStoryId);
  const attributes = await resolveAttributeEntries(env, identity, input.attributes);
  let mainStoryId = input.mainStoryId || null;
  if (!mainStoryId && existing.main_story_id) {
    const currentMainStory = await env.DB.prepare(
      "SELECT visibility FROM articles WHERE id = ?"
    ).bind(existing.main_story_id).first();
    if (currentMainStory?.visibility !== "published") mainStoryId = existing.main_story_id;
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE articles
      SET title = ?, type = ?, summary = ?, content = ?, tags_json = ?,
        story_categories_json = ?, is_hidden_story = ?, main_story_id = ?, updated_at = ?
      WHERE id = ? AND visibility = 'published'
    `).bind(
      input.title, input.type, input.summary, input.content, JSON.stringify(input.tags),
      JSON.stringify(input.storyCategories), input.isHiddenStory ? 1 : 0,
      mainStoryId, now, id
    ),
    env.DB.prepare(`
      DELETE FROM article_links
      WHERE source_id = ?
      AND target_id IN (SELECT id FROM articles WHERE visibility = 'published')
    `).bind(id),
    ...relations.map(({ targetId, label }) => env.DB.prepare(
      "INSERT INTO article_links (source_id, target_id, relation_label, created_at) VALUES (?, ?, ?, ?)"
    ).bind(id, targetId, label, now)),
    env.DB.prepare(`
      DELETE FROM story_attribute_links
      WHERE story_id = ?
        AND attribute_id IN (SELECT id FROM attribute_entries WHERE visibility = 'published')
    `).bind(id),
    ...attributes.filter((attribute) => attribute.isNew).map((attribute) => env.DB.prepare(`
      INSERT INTO attribute_entries (id, slug, title, type, summary, content, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
    `).bind(attribute.id, attribute.slug, attribute.title, attribute.type, attribute.summary, attribute.content, now, now)),
    ...attributes.map((attribute) => env.DB.prepare(`
      INSERT INTO story_attribute_links (story_id, attribute_id, created_at)
      VALUES (?, ?, ?)
    `).bind(id, attribute.id, now))
  ]);
  return getPublishedArticle(env, id);
}

function validatePlaylistInput(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!Array.isArray(body.articleIds)) throw new InputError("Daftar cerita playlist tidak valid.");
  if (body.articleIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new InputError("ID cerita dalam playlist tidak valid.");
  }
  const articleIds = [...new Set(body.articleIds.map((id) => id.trim()))];
  if (!title || title.length > 100) throw new InputError("Nama playlist wajib diisi dan maksimal 100 karakter.");
  if (description.length > 500) throw new InputError("Deskripsi playlist maksimal 500 karakter.");
  if (articleIds.length < 1 || articleIds.length > 100) {
    throw new InputError("Playlist harus berisi 1 sampai 100 cerita.");
  }
  if (articleIds.some((id) => id.length > 100)) throw new InputError("ID cerita dalam playlist tidak valid.");
  return { title, description, articleIds };
}

async function validatePublishedStories(env, articleIds) {
  const placeholders = articleIds.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM articles WHERE visibility = 'published' AND id IN (${placeholders})`
  ).bind(...articleIds).first();
  if (Number(result?.count) !== articleIds.length) {
    throw new InputError("Playlist hanya bisa berisi cerita yang sudah diterbitkan.");
  }
}

async function publicPlaylists(env) {
  const result = await env.DB.prepare(`
    SELECT p.id, p.slug, p.title, p.description, p.updated_at,
      COUNT(a.id) AS story_count
    FROM playlists p
    LEFT JOIN playlist_items i ON i.playlist_id = p.id
    LEFT JOIN articles a ON a.id = i.article_id AND a.visibility = 'published'
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.title
    LIMIT 500
  `).all();
  return result.results.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    storyCount: Number(row.story_count),
    updatedAt: row.updated_at
  }));
}

async function getPublicPlaylist(env, slug) {
  const playlist = await env.DB.prepare(`
    SELECT id, slug, title, description, created_at, updated_at
    FROM playlists WHERE slug = ?
  `).bind(slug).first();
  if (!playlist) return null;
  const stories = await env.DB.prepare(`
    SELECT a.id, a.slug, a.title, a.type, a.summary, a.updated_at
    FROM playlist_items i
    JOIN articles a ON a.id = i.article_id
    WHERE i.playlist_id = ? AND a.visibility = 'published'
    ORDER BY i.position
  `).bind(playlist.id).all();
  return {
    id: playlist.id,
    slug: playlist.slug,
    title: playlist.title,
    description: playlist.description,
    createdAt: playlist.created_at,
    updatedAt: playlist.updated_at,
    stories: stories.results
  };
}

async function createPublicPlaylist(env, body) {
  const input = validatePlaylistInput(body);
  await validatePublishedStories(env, input.articleIds);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = `${slugBase(input.title)}-${id.slice(0, 8)}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO playlists (id, slug, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, slug, input.title, input.description, now, now),
    ...input.articleIds.map((articleId, position) => env.DB.prepare(`
      INSERT INTO playlist_items (playlist_id, article_id, position, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(id, articleId, position, now))
  ]);
  return getPublicPlaylist(env, slug);
}

async function updatePublicPlaylist(env, id, body) {
  const exists = await env.DB.prepare("SELECT id FROM playlists WHERE id = ?").bind(id).first();
  if (!exists) return null;
  const input = validatePlaylistInput(body);
  await validatePublishedStories(env, input.articleIds);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE playlists SET title = ?, description = ?, updated_at = ? WHERE id = ?")
      .bind(input.title, input.description, now, id),
    env.DB.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").bind(id),
    ...input.articleIds.map((articleId, position) => env.DB.prepare(`
      INSERT INTO playlist_items (playlist_id, article_id, position, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(id, articleId, position, now))
  ]);
  const playlist = await env.DB.prepare("SELECT slug FROM playlists WHERE id = ?").bind(id).first();
  return playlist ? getPublicPlaylist(env, playlist.slug) : null;
}

async function getManagedOwner(env, identity, id) {
  const article = await env.DB.prepare(
    "SELECT owner_id FROM articles WHERE id = ? AND owner_id IN (?, ?)"
  ).bind(id, identity.id, PUBLIC_AUTHOR_ID).first();
  return article ? { ...identity, id: article.owner_id } : null;
}

async function updateArticle(env, identity, id, body) {
  const owner = await getManagedOwner(env, identity, id);
  if (!owner) return null;
  const input = validateArticleInput(body);
  const parentId = input.parentId || null;
  const relations = await validateRelations(env, identity, id, input.parentId, input.relations, input.mainStoryId);
  const attributes = await resolveAttributeEntries(env, identity, input.attributes);
  await assertOwnedImage(env, identity, input.imageKey);
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`
      UPDATE articles
      SET title = ?, type = ?, summary = ?, content = ?, visibility = ?,
        parent_id = ?, image_key = ?, tags_json = ?, story_categories_json = ?,
        is_hidden_story = ?, main_story_id = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).bind(input.title, input.type, input.summary, input.content, input.visibility,
      parentId, input.imageKey, JSON.stringify(input.tags), JSON.stringify(input.storyCategories),
      input.isHiddenStory ? 1 : 0, input.mainStoryId || null, now, id, owner.id),
    env.DB.prepare("DELETE FROM article_links WHERE source_id = ?").bind(id),
    ...relations.map(({ targetId, label }) => env.DB.prepare(
      "INSERT INTO article_links (source_id, target_id, relation_label, created_at) VALUES (?, ?, ?, ?)"
    ).bind(id, targetId, label, now)),
    env.DB.prepare("DELETE FROM story_attribute_links WHERE story_id = ?").bind(id),
    ...attributes.filter((attribute) => attribute.isNew).map((attribute) => env.DB.prepare(`
      INSERT INTO attribute_entries (id, slug, title, type, summary, content, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(attribute.id, attribute.slug, attribute.title, attribute.type, attribute.summary, attribute.content, input.visibility, now, now)),
    ...attributes.map((attribute) => env.DB.prepare(`
      INSERT INTO story_attribute_links (story_id, attribute_id, created_at)
      VALUES (?, ?, ?)
    `).bind(id, attribute.id, now))
  ];
  await env.DB.batch(statements);
  return getArticle(env, owner, id);
}

async function uploadImage(request, env, identity) {
  const body = await readJson(request);
  const mime = typeof body.mime === "string" ? body.mime.toLowerCase() : "";
  const extension = IMAGE_TYPES.get(mime);
  if (!extension || typeof body.data !== "string") throw new InputError("Format gambar tidak didukung.");
  const match = body.data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].toLowerCase() !== mime) throw new InputError("Data gambar tidak valid.");
  const binary = atob(match[2]);
  if (!binary.length || binary.length > MAX_IMAGE_BYTES) throw new InputError("Ukuran gambar maksimal 1 MB.");
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
  await env.DB.prepare(`
    INSERT INTO image_assets (key, owner_id, content_type, byte_size, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(key, identity.id, mime, bytes.length, bytes, now).run();
  return { imageKey: key, imageUrl: `/media/${encodeURIComponent(key)}` };
}

async function deleteImage(env, identity, key) {
  const image = await env.DB.prepare("SELECT key FROM image_assets WHERE key = ? AND owner_id = ?")
    .bind(key, identity.id).first();
  if (!image) return false;
  const usage = await env.DB.prepare("SELECT COUNT(*) AS count FROM articles WHERE image_key = ?")
    .bind(key).first();
  if (Number(usage?.count) > 0) throw new InputError("Gambar masih dipakai oleh artikel.");
  await env.DB.prepare("DELETE FROM image_assets WHERE key = ? AND owner_id = ?")
    .bind(key, identity.id).run();
  return true;
}

async function imageResponse(env, key) {
  const image = await env.DB.prepare("SELECT content_type, hex(data) AS data_hex FROM image_assets WHERE key = ?")
    .bind(key).first();
  if (!image?.data_hex) return new Response("Not found", { status: 404 });
  const bytes = new Uint8Array(image.data_hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(image.data_hex.slice(index * 2, index * 2 + 2), 16);
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": image.content_type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function deleteArticle(env, identity, id) {
  const owner = await getManagedOwner(env, identity, id);
  if (!owner) return false;
  const article = await env.DB.prepare("SELECT id, parent_id, image_key FROM articles WHERE id = ? AND owner_id = ?")
    .bind(id, owner.id).first();
  if (!article) return false;
  await env.DB.batch([
    env.DB.prepare("UPDATE articles SET parent_id = ?, updated_at = ? WHERE parent_id = ? AND owner_id IN (?, ?)")
      .bind(article.parent_id, new Date().toISOString(), id, identity.id, PUBLIC_AUTHOR_ID),
    env.DB.prepare("UPDATE articles SET main_story_id = NULL WHERE main_story_id = ?").bind(id),
    env.DB.prepare("DELETE FROM articles WHERE id = ? AND owner_id = ?").bind(id, owner.id)
  ]);
  if (article.image_key) {
    const usage = await env.DB.prepare("SELECT COUNT(*) AS count FROM articles WHERE image_key = ?")
      .bind(article.image_key).first();
    if (Number(usage?.count) === 0) await deleteImage(env, identity, article.image_key);
  }
  return true;
}

async function deletePublishedArticle(env, id) {
  const article = await env.DB.prepare(`
    SELECT id, owner_id, parent_id, image_key
    FROM articles
    WHERE id = ? AND visibility = 'published'
  `).bind(id).first();
  if (!article) return false;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE articles SET parent_id = ?, updated_at = ? WHERE parent_id = ?")
      .bind(article.parent_id, now, id),
    env.DB.prepare("UPDATE articles SET main_story_id = NULL WHERE main_story_id = ?").bind(id),
    env.DB.prepare("DELETE FROM articles WHERE id = ? AND visibility = 'published'").bind(id)
  ]);
  if (article.image_key) {
    await env.DB.prepare(`
      DELETE FROM image_assets
      WHERE key = ? AND owner_id = ?
        AND NOT EXISTS (SELECT 1 FROM articles WHERE image_key = ?)
    `).bind(article.image_key, article.owner_id, article.image_key).run();
  }
  return true;
}

async function importArticles(env, identity, body) {
  const source = Array.isArray(body.articles) ? body.articles
    : Array.isArray(body.notes) ? body.notes
      : Array.isArray(body.attributes) ? [] : null;
  if (!source) throw new InputError("Cadangan harus berisi daftar artikel.");
  if (source.length > 300) throw new InputError("Impor dibatasi maksimal 300 artikel per berkas.");
  if (body.attributes !== undefined && !Array.isArray(body.attributes)) {
    throw new InputError("Daftar artikel atribut dalam cadangan tidak valid.");
  }
  const standaloneSource = Array.isArray(body.attributes) ? body.attributes : [];
  if (standaloneSource.length > 500) throw new InputError("Impor dibatasi maksimal 500 artikel atribut per berkas.");
  const ids = source.map((item) => item?.id);
  if (ids.some((id) => typeof id !== "string" || !id || id.length > 100) || new Set(ids).size !== ids.length) {
    throw new InputError("Setiap artikel cadangan harus memiliki ID unik yang valid.");
  }
  const currentRows = await env.DB.prepare("SELECT id, parent_id, owner_id FROM articles WHERE owner_id IN (?, ?)")
    .bind(identity.id, PUBLIC_AUTHOR_ID).all();
  const existingIds = new Set(currentRows.results.map((row) => row.id));
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const conflicts = await env.DB.prepare(
      `SELECT id, owner_id FROM articles WHERE id IN (${placeholders})`
    ).bind(...ids).all();
    if (conflicts.results.some((row) => !existingIds.has(row.id))) {
      throw new InputError("Cadangan memiliki ID artikel yang tidak dapat dikelola akun ini.");
    }
  }
  const importedIds = new Set(ids);
  const importedAttributes = new Map();
  const importedAttributeDefinitions = new Map();
  const resolveImportedAttribute = (raw, input) => {
    const definition = JSON.stringify([input.title, input.type, input.summary, input.content]);
    const sourceId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    if (sourceId.length > 100) throw new InputError("ID atribut dalam cadangan tidak valid.");
    const key = sourceId ? `id:${sourceId}` : `definition:${definition}`;
    const existing = importedAttributes.get(key);
    if (existing) {
      if (JSON.stringify([existing.title, existing.type, existing.summary, existing.content]) !== definition) {
        throw new InputError(`Atribut “${input.title}” memiliki isi yang berbeda pada cadangan.`);
      }
      return existing;
    }
    if (!sourceId && importedAttributeDefinitions.has(definition)) {
      return importedAttributeDefinitions.get(definition);
    }
    const id = sourceId || crypto.randomUUID();
    const imported = {
      ...input,
      id,
      slug: `${slugBase(input.title)}-${id.slice(0, 8)}`
    };
    importedAttributes.set(key, imported);
    importedAttributeDefinitions.set(definition, imported);
    return imported;
  };
  for (const item of standaloneSource) {
    const attribute = validateAttributeInput(item);
    resolveImportedAttribute(item, attribute);
  }
  const normalized = source.map((item) => {
    const rawAttributes = Array.isArray(item.attributes) ? item.attributes : [];
    const input = validateArticleInput({
      ...item,
      attributes: rawAttributes.map(({ id: _id, slug: _slug, visibility: _visibility, ...attribute }) => attribute),
      imageKey: ""
    });
    const id = item.id;
    const attributes = input.attributes.map((attribute, index) => {
      const raw = rawAttributes[index] || {};
      return resolveImportedAttribute(raw, {
        ...attribute,
        visibility: raw.visibility === "published" ? "published" : "draft"
      });
    });
    return {
      id,
      ownerId: identity.id,
      slug: `${slugBase(input.title)}-${crypto.randomUUID().slice(0, 8)}`,
      ...input,
      attributes,
      parentId: input.parentId || null
    };
  });
  const importedById = new Map(normalized.map((item) => [item.id, item]));
  let relationCount = 0;
  for (const article of normalized) {
    if (article.relatedIds.includes(article.id)) {
      throw new InputError(`Artikel “${article.title}” tidak boleh terhubung dengan dirinya sendiri.`);
    }
    if (article.mainStoryId === article.id) {
      throw new InputError(`Cerita “${article.title}” tidak bisa menjadi cerita utama untuk dirinya sendiri.`);
    }
    const references = [article.parentId, article.mainStoryId, ...article.relatedIds].filter(Boolean);
    relationCount += article.relations.length;
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
      let existingParent = await env.DB.prepare("SELECT parent_id FROM articles WHERE id = ? AND owner_id IN (?, ?)")
        .bind(parentId, identity.id, PUBLIC_AUTHOR_ID).first();
      while (existingParent?.parent_id) {
        if (seen.has(existingParent.parent_id)) throw new InputError("Hubungan parent dalam cadangan membentuk lingkaran.");
        seen.add(existingParent.parent_id);
        existingParent = await env.DB.prepare("SELECT parent_id FROM articles WHERE id = ? AND owner_id IN (?, ?)")
          .bind(existingParent.parent_id, identity.id, PUBLIC_AUTHOR_ID).first();
      }
    }
  }

  const now = new Date().toISOString();
  const statements = [];
  const importedAttributeRows = [...importedAttributes.values()];
  for (const attribute of importedAttributeRows) {
    const existing = await env.DB.prepare("SELECT id FROM attribute_entries WHERE id = ?").bind(attribute.id).first();
    if (existing) {
      statements.push(env.DB.prepare(`
        UPDATE attribute_entries
        SET title = ?, type = ?, summary = ?, content = ?, visibility = ?, updated_at = ?
        WHERE id = ?
      `).bind(attribute.title, attribute.type, attribute.summary, attribute.content, attribute.visibility, now, attribute.id));
    } else {
      statements.push(env.DB.prepare(`
        INSERT INTO attribute_entries (id, slug, title, type, summary, content, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(attribute.id, attribute.slug, attribute.title, attribute.type, attribute.summary, attribute.content, attribute.visibility, now, now));
    }
  }
  for (const article of normalized) {
    if (existingIds.has(article.id)) {
      statements.push(env.DB.prepare(`
        UPDATE articles
        SET title = ?, type = ?, summary = ?, content = ?, visibility = ?,
          tags_json = ?, story_categories_json = ?, is_hidden_story = ?, updated_at = ?
        WHERE id = ? AND owner_id IN (?, ?)
      `).bind(article.title, article.type, article.summary, article.content, article.visibility,
        JSON.stringify(article.tags), JSON.stringify(article.storyCategories),
        article.isHiddenStory ? 1 : 0, now,
        article.id, identity.id, PUBLIC_AUTHOR_ID));
    } else {
      statements.push(env.DB.prepare(`
        INSERT INTO articles (
          id, owner_id, slug, title, type, summary, content, visibility,
          parent_id, image_key, tags_json, story_categories_json, is_hidden_story, main_story_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?, ?, ?, NULL, ?, ?)
      `).bind(article.id, identity.id, article.slug, article.title, article.type, article.summary,
        article.content, article.visibility, JSON.stringify(article.tags),
        JSON.stringify(article.storyCategories), article.isHiddenStory ? 1 : 0,
        article.createdAt || now, now));
    }
  }
  for (const article of normalized) {
    statements.push(env.DB.prepare(`
      UPDATE articles SET parent_id = ?, main_story_id = ? WHERE id = ?
    `).bind(article.parentId, article.mainStoryId || null, article.id));
  }
  for (const article of normalized) {
    statements.push(env.DB.prepare("DELETE FROM article_links WHERE source_id = ?").bind(article.id));
    statements.push(env.DB.prepare("DELETE FROM story_attribute_links WHERE story_id = ?").bind(article.id));
  }
  for (const article of normalized) {
    for (const { targetId, label } of article.relations) {
      statements.push(env.DB.prepare(
        "INSERT INTO article_links (source_id, target_id, relation_label, created_at) VALUES (?, ?, ?, ?)"
      ).bind(article.id, targetId, label, now));
    }
    for (const attribute of article.attributes) {
      statements.push(env.DB.prepare(`
        INSERT INTO story_attribute_links (story_id, attribute_id, created_at)
        VALUES (?, ?, ?)
      `).bind(article.id, attribute.id, now));
    }
  }
  if (statements.length) await env.DB.batch(statements);
  const skippedImages = source.filter((item) => item.imageUrl || item.imageKey).length;
  return { count: normalized.length, attributeCount: importedAttributeRows.length, skippedImages };
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
  if (path === "/api/admin/attributes" && method === "GET") return json(await getAdminAttributeEntries(env));
  if (path === "/api/admin/attributes" && method === "POST") {
    const input = validateAttributeInput(await readJson(request));
    const id = await createAttributeEntry(env, input);
    const entry = await env.DB.prepare("SELECT * FROM attribute_entries WHERE id = ?").bind(id).first();
    return json(attributeEntryFromRow(entry), 201);
  }
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
    return json({
      version: 1,
      exportedAt: new Date().toISOString(),
      articles: await getAdminArticles(env, identity),
      attributes: await getAdminAttributeEntries(env)
    });
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
    if (method === "GET") {
      const owner = await getManagedOwner(env, identity, id);
      const article = owner ? await getArticle(env, owner, id) : null;
      return article ? json(article) : errorResponse("Artikel tidak ditemukan.", 404);
    }
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
  const attributeMatch = path.match(/^\/api\/admin\/attributes\/([^/]+)$/);
  if (attributeMatch && (method === "PUT" || method === "DELETE")) {
    const id = decodeURIComponent(attributeMatch[1]);
    if (method === "DELETE") {
      return (await deleteAttributeEntry(env, id))
        ? new Response(null, { status: 204 })
        : errorResponse("Entri atribut tidak ditemukan.", 404);
    }
    const input = validateAttributeInput(await readJson(request));
    if (!await updateAttributeEntry(env, id, input)) return errorResponse("Entri atribut tidak ditemukan.", 404);
    const entry = await env.DB.prepare("SELECT * FROM attribute_entries WHERE id = ?").bind(id).first();
    return json(attributeEntryFromRow(entry));
  }
  return errorResponse("Endpoint tidak ditemukan.", 404);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (path === "/" && (method === "GET" || method === "HEAD")) {
    const asset = await env.ASSETS.fetch(new Request(url, { method: "GET", headers: request.headers }));
    if (!asset.ok) return asset;
    const headers = new Headers(asset.headers);
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    headers.delete("ETag");
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "index, follow");
    if (method === "HEAD") return new Response(null, { status: asset.status, headers });
    const marker = "<!-- PUBLIC_ARTICLE_CATALOG -->";
    const html = await asset.text();
    if (!html.includes(marker)) throw new Error("Public article catalog insertion point is missing.");
    return new Response(html.replace(marker, await renderPublicArticleCatalog(env, url)), {
      status: asset.status,
      headers
    });
  }
  if (path === "/guide" && (method === "GET" || method === "HEAD")) {
    const guideResponse = await env.ASSETS.fetch(new Request(new URL("/guide-content.html", url), {
      headers: request.headers
    }));
    if (!guideResponse.ok) throw new Error(`Panduan gagal dimuat (${guideResponse.status}).`);
    const response = pageResponse(
      "Panduan",
      "Panduan Lucimon Library: cerita, atribut, hubungan, playlist, publikasi, dan cadangan.",
      await guideResponse.text(),
      200,
      { canonicalUrl: new URL("/guide", publicSiteOrigin(env, url)).href }
    );
    return method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
  if (path === "/robots.txt" && (method === "GET" || method === "HEAD")) {
    const origin = publicSiteOrigin(env, url);
    const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin/\nSitemap: ${new URL("/sitemap.xml", origin).href}\n`;
    return new Response(method === "HEAD" ? null : body, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }
    });
  }
  if (path === "/sitemap.xml" && (method === "GET" || method === "HEAD")) {
    const [articles, attributes] = await Promise.all([
      env.DB.prepare("SELECT slug, updated_at FROM articles WHERE visibility = 'published' ORDER BY slug").all(),
      env.DB.prepare("SELECT slug, updated_at FROM attribute_entries WHERE visibility = 'published' ORDER BY slug").all()
    ]);
    const origin = publicSiteOrigin(env, url);
    const escapeXml = (value) => escapeHtml(value).replace(/&#39;/g, "&apos;");
    const entries = [
      { loc: new URL("/", origin).href },
      { loc: new URL("/guide", origin).href },
      ...articles.results.map((article) => ({
        loc: new URL(`/article/${encodeURIComponent(article.slug)}`, origin).href,
        lastmod: article.updated_at
      })),
      ...attributes.results.map((attribute) => ({
        loc: new URL(`/attribute/${encodeURIComponent(attribute.slug)}`, origin).href,
        lastmod: attribute.updated_at
      }))
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>`;
    return new Response(method === "HEAD" ? null : body, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" }
    });
  }
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
  if (path === "/api/articles" && method === "GET") {
    const articles = await publicArticles(env, url.searchParams.get("q") || "");
    const origin = publicSiteOrigin(env, url);
    return json(articles.map((article) => ({
      ...article,
      url: new URL(`/article/${encodeURIComponent(article.slug)}`, origin).href,
      contentUrl: new URL(`/api/articles/${encodeURIComponent(article.slug)}`, origin).href
    })));
  }
  const articleApiMatch = path.match(/^\/api\/articles\/([^/]+)$/);
  if (articleApiMatch && method === "GET") {
    const article = await getPublishedArticle(env, decodeURIComponent(articleApiMatch[1]));
    return article ? json(article) : errorResponse("Artikel tidak ditemukan atau belum diterbitkan.", 404);
  }
  if (path === "/api/public/attributes" && method === "GET") {
    return json(await getPublicAttributeEntries(env));
  }
  if (path === "/api/attributes" && method === "GET") {
    const attributes = await getPublicAttributeEntries(env);
    const origin = publicSiteOrigin(env, url);
    return json(attributes.map((attribute) => ({
      ...attribute,
      url: new URL(`/attribute/${encodeURIComponent(attribute.slug)}`, origin).href,
      contentUrl: new URL(`/api/attributes/${encodeURIComponent(attribute.slug)}`, origin).href
    })));
  }
  const attributeApiMatch = path.match(/^\/api\/attributes\/([^/]+)$/);
  if (attributeApiMatch && method === "GET") {
    const attribute = await getPublicAttribute(env, decodeURIComponent(attributeApiMatch[1]));
    return attribute ? json(attribute) : errorResponse("Atribut tidak ditemukan.", 404);
  }
  if (path === "/api/public/attributes" && method === "POST") {
    try {
      const input = validateAttributeInput(await readJson(request), "published");
      const id = await createAttributeEntry(env, input);
      const entry = await env.DB.prepare("SELECT * FROM attribute_entries WHERE id = ?").bind(id).first();
      return json(attributeEntryFromRow(entry), 201);
    } catch (error) {
      if (error instanceof InputError) return errorResponse(error.message, error.status);
      throw error;
    }
  }
  const publicAttributeMatch = path.match(/^\/api\/public\/attributes\/([^/]+)$/);
  if (publicAttributeMatch) {
    const key = decodeURIComponent(publicAttributeMatch[1]);
    if (method === "GET") {
      const attribute = await getPublicAttribute(env, key);
      return attribute ? json(attribute) : errorResponse("Atribut tidak ditemukan.", 404);
    }
    if (method === "PUT" || method === "DELETE") {
      try {
        const existing = await env.DB.prepare(
          "SELECT id, slug FROM attribute_entries WHERE id = ? AND visibility = 'published'"
        ).bind(key).first();
        if (!existing) return errorResponse("Artikel atribut tidak ditemukan.", 404);
        if (method === "DELETE") {
          return (await deleteAttributeEntry(env, existing.id))
            ? new Response(null, { status: 204 })
            : errorResponse("Artikel atribut tidak ditemukan.", 404);
        }
        const input = validateAttributeInput(await readJson(request), "published");
        if (!await updateAttributeEntry(env, existing.id, input)) {
          return errorResponse("Artikel atribut tidak ditemukan.", 404);
        }
        return json(await getPublicAttribute(env, existing.slug));
      } catch (error) {
        if (error instanceof InputError) return errorResponse(error.message, error.status);
        throw error;
      }
    }
  }
  const publicArticleMatch = path.match(/^\/api\/public\/articles\/([^/]+)$/);
  if (publicArticleMatch) {
    const id = decodeURIComponent(publicArticleMatch[1]);
    if (method === "GET") {
      const article = await getPublishedArticle(env, id);
      return article ? json(article) : errorResponse("Artikel tidak ditemukan atau belum diterbitkan.", 404);
    }
    try {
      if (method === "PUT") {
        const article = await updatePublishedArticle(env, id, await readJson(request, 1024 * 1024));
        return article ? json(article) : errorResponse("Artikel tidak ditemukan atau belum diterbitkan.", 404);
      }
      if (method === "DELETE") {
        return (await deletePublishedArticle(env, id))
          ? new Response(null, { status: 204 })
          : errorResponse("Artikel tidak ditemukan atau belum diterbitkan.", 404);
      }
    } catch (error) {
      if (error instanceof InputError) return errorResponse(error.message, error.status);
      throw error;
    }
  }
  if (path === "/api/public/articles" && method === "POST") {
    try {
      return json(await createPublicArticle(env, await readJson(request, 1024 * 1024)), 201);
    } catch (error) {
      if (error instanceof InputError) return errorResponse(error.message, error.status);
      throw error;
    }
  }
  if (path === "/api/public/playlists" && method === "GET") {
    return json(await publicPlaylists(env));
  }
  if (path === "/api/public/playlists" && method === "POST") {
    try {
      return json(await createPublicPlaylist(env, await readJson(request)), 201);
    } catch (error) {
      if (error instanceof InputError) return errorResponse(error.message, error.status);
      throw error;
    }
  }
  const publicPlaylistMatch = path.match(/^\/api\/public\/playlists\/([^/]+)$/);
  if (publicPlaylistMatch) {
    const id = decodeURIComponent(publicPlaylistMatch[1]);
    try {
      if (method === "GET") {
        const playlist = await getPublicPlaylist(env, id);
        return playlist ? json(playlist) : errorResponse("Playlist tidak ditemukan.", 404);
      }
      if (method === "PUT") {
        const playlist = await updatePublicPlaylist(env, id, await readJson(request));
        return playlist ? json(playlist) : errorResponse("Playlist tidak ditemukan.", 404);
      }
    } catch (error) {
      if (error instanceof InputError) return errorResponse(error.message, error.status);
      throw error;
    }
  }
  if (path.startsWith("/api/")) return errorResponse("Endpoint tidak ditemukan.", 404);
  if (path.startsWith("/attribute/") && method === "GET") {
    return renderPublicAttribute(env, decodeURIComponent(path.slice("/attribute/".length)), url);
  }
  if (path.startsWith("/article/") && method === "GET") {
    return renderPublicArticle(env, decodeURIComponent(path.slice("/article/".length)), url);
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
