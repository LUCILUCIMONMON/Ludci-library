(function () {
  "use strict";

  const TYPES = ["Dunia", "Karakter", "Alur", "Tempat", "Catatan"];
  const STORY_CATEGORIES = ["Canon", "Alternative", "Retelling", "Sidequel", "Spin-off", "Reboot", "Restart", "What if"];
  const pageContent = document.getElementById("page-content");
  const searchInput = document.getElementById("search-input");
  const dialog = document.getElementById("note-dialog");
  const form = document.getElementById("note-form");
  const attributeDialog = document.getElementById("attribute-dialog");
  const attributeForm = document.getElementById("attribute-form");
  const toast = document.getElementById("toast");
  const playlistDialog = document.getElementById("playlist-dialog");
  const attributeSearch = document.getElementById("attribute-search");
  const attributeSelect = document.getElementById("attribute-select");
  const imageField = document.getElementById("field-image");
  const contentEditor = document.getElementById("field-content");
  const relatedSearch = document.getElementById("related-search");
  const relatedOptions = document.getElementById("related-options");
  const imagePreviewWrap = document.getElementById("image-preview-wrap");
  const imagePreview = document.getElementById("image-preview");
  const publicPublicationNotice = document.getElementById("public-publication-notice");
  const adminOnlyFields = Array.from(form.querySelectorAll("[data-admin-only]"));
  const fieldRow = form.querySelector(".field-row");
  let notes = [];
  let attributeEntries = [];
  let playlists = [];
  let profile = null;
  let isReady = false;
  let pendingImage = null;
  let imageUrl = "";
  let removeImage = false;
  let previewObjectUrl = "";
  let toastTimer;
  let searchTimer;
  let searchSequence = 0;
  let savedEditorRange = null;
  let selectedRelatedIds = new Set();
  let selectedRelationLabels = new Map();
  let selectedAttributes = [];
  let playlistItemIds = [];
  let editingPlaylistId = "";
  let playlistRenderSequence = 0;
  let isPublicSubmission = false;
  let isPublicEdit = false;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
    });
    const result = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(result && result.error ? result.error : `Permintaan gagal (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function normalizeNote(note) {
    if (!note || typeof note !== "object" || typeof note.title !== "string" || typeof note.id !== "string") {
      throw new Error("Ada cerita dengan format tidak valid.");
    }
    const relations = Array.isArray(note.relations)
      ? note.relations.filter((relation) => relation && typeof relation.targetId === "string")
        .map((relation) => ({ targetId: relation.targetId, label: typeof relation.label === "string" ? relation.label : "terkait" }))
      : Array.isArray(note.relatedIds)
        ? note.relatedIds.filter((id) => typeof id === "string").map((targetId) => ({ targetId, label: "terkait" }))
        : [];
    return {
      id: note.id,
      slug: typeof note.slug === "string" ? note.slug : "",
      title: note.title,
      type: TYPES.includes(note.type) ? note.type : "Catatan",
      summary: typeof note.summary === "string" ? note.summary : "",
      content: typeof note.content === "string" ? note.content : "",
      parentId: typeof note.parentId === "string" ? note.parentId : "",
      mainStoryId: typeof note.mainStoryId === "string" ? note.mainStoryId : "",
      mainStoryTitle: typeof note.mainStoryTitle === "string" ? note.mainStoryTitle : "",
      storyCategories: Array.isArray(note.storyCategories)
        ? note.storyCategories.filter((category) => STORY_CATEGORIES.includes(category))
        : ["Canon"],
      isHiddenStory: note.isHiddenStory === true,
      relations,
      relatedIds: relations.map((relation) => relation.targetId),
      attributes: Array.isArray(note.attributes)
        ? note.attributes.filter((attribute) => attribute && typeof attribute.id === "string" && typeof attribute.title === "string")
        : [],
      tags: Array.isArray(note.tags) ? note.tags.filter((tag) => typeof tag === "string") : [],
      visibility: note.visibility === "published" ? "published" : "draft",
      imageKey: typeof note.imageKey === "string" ? note.imageKey : "",
      imageUrl: typeof note.imageUrl === "string" ? note.imageUrl : "",
      createdAt: typeof note.createdAt === "string" ? note.createdAt : new Date().toISOString(),
      updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString()
    };
  }

  async function loadNotes() {
    pageContent.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">▤</div><h3>Membuka perpustakaan…</h3><p>Menghubungkan ke penyimpanan Lucimon Library.</p></div>';
    try {
      if (location.pathname.startsWith("/admin")) {
        const session = await api("/api/admin/session");
        profile = session.profile;
        [notes, attributeEntries] = await Promise.all([
          api("/api/admin/articles").then((result) => result.map(normalizeNote)),
          api("/api/admin/attributes")
        ]);
      } else {
        profile = null;
        [notes, attributeEntries] = await Promise.all([
          api(publicArticlesUrl()).then((result) => result.map(normalizeNote)),
          api("/api/public/attributes")
        ]);
      }
      playlists = await api("/api/public/playlists");
      isReady = true;
      render();
    } catch (error) {
      console.error("Gagal memuat Lucimon Library:", error);
      document.getElementById("note-count").textContent = "—";
      if (location.pathname.startsWith("/admin")) {
        const redirect = encodeURIComponent(`${location.origin}/admin`);
        pageContent.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">⌑</div><h3>Login pengelola</h3><p>Masuk dengan akun yang diizinkan Cloudflare Access untuk mengelola cerita.</p><a class="button button-primary" href="/cdn-cgi/access/login?redirect_url=${redirect}">Masuk dengan Cloudflare Access</a></div>`;
      } else {
        pageContent.innerHTML = `<div class="empty-state server-error"><div class="empty-icon" aria-hidden="true">!</div><h3>Perpustakaan belum dapat dibuka</h3><p>Pastikan Worker dan database Cloudflare sudah dikonfigurasi, lalu coba muat ulang halaman.</p></div>`;
      }
      showToast(error.message);
    }
  }

  async function refreshNotes() {
    [notes, attributeEntries] = await Promise.all([
      api(profile ? "/api/admin/articles" : publicArticlesUrl()).then((result) => result.map(normalizeNote)),
      api(profile ? "/api/admin/attributes" : "/api/public/attributes")
    ]);
    render();
  }

  function publicArticlesUrl(query = "") {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const search = params.toString();
    return `/api/public/articles${search ? `?${search}` : ""}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function safeText(value) {
    return escapeHtml(value || "");
  }

  function contentForEditor(value) {
    const content = String(value || "").trim();
    if (!content) return "";
    if (/<(?:p|br|h[1-6]|ul|ol|li|div|blockquote|hr|strong|b|em|i|u|s|a|pre|code)\b/i.test(content)) return content;
    return content.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
  }

  function serializeEditorContent() {
    for (const node of Array.from(contentEditor.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const paragraph = document.createElement("p");
        paragraph.textContent = node.textContent;
        node.replaceWith(paragraph);
      } else if (node instanceof HTMLDivElement) {
        let contentNode = node;
        while (contentNode.childNodes.length === 1 && contentNode.firstChild instanceof HTMLDivElement) {
          contentNode = contentNode.firstChild;
        }
        const paragraph = document.createElement("p");
        paragraph.append(...Array.from(contentNode.childNodes));
        node.replaceWith(paragraph);
      }
    }
    return contentEditor.innerHTML.trim();
  }

  function renderRelatedOptions() {
    const query = relatedSearch.value.trim().toLocaleLowerCase("id");
    const available = notes
      .filter((note) => note.id !== document.getElementById("field-id").value)
      .filter((note) => !query || `${note.title} ${note.type}`.toLocaleLowerCase("id").includes(query))
      .sort((a, b) => a.title.localeCompare(b.title, "id"));
    relatedOptions.innerHTML = available.length
      ? available.map((note) => `<label class="related-option">
          <input type="checkbox" name="relatedIds" value="${escapeHtml(note.id)}" ${selectedRelatedIds.has(note.id) ? "checked" : ""}>
          <span><strong>${safeText(note.title)}</strong><small>${safeText(note.type)}</small>
            ${selectedRelatedIds.has(note.id) ? `<input class="text-field relation-label-input" type="text" maxlength="60" data-relation-target="${escapeHtml(note.id)}" aria-label="Label hubungan dengan ${safeText(note.title)}" placeholder="Jenis hubungan, mis. saudara dari" value="${escapeHtml(selectedRelationLabels.get(note.id) || "")}">` : ""}
          </span>
        </label>`).join("")
      : '<p class="related-empty">Tidak ada cerita yang cocok.</p>';
    const count = selectedRelatedIds.size;
    document.getElementById("related-selected-count").textContent = count
      ? `${count} cerita dipilih.`
      : "Belum ada cerita yang dipilih.";
  }

  function renderAttributeRows() {
    const list = document.getElementById("attributes-list");
    list.innerHTML = selectedAttributes.map((attribute, index) => `
      <div class="attribute-entry-row">
        <div><strong>${safeText(attribute.title)}</strong><small>${safeText(attribute.type)}${attribute.summary ? ` · ${safeText(attribute.summary)}` : ""}${attribute.isNew ? " · atribut baru" : ""}</small></div>
        <button class="button button-quiet attribute-remove" type="button" data-remove-attribute="${index}" aria-label="Hapus atribut">×</button>
      </div>`).join("");
    const selectedIds = new Set(selectedAttributes.filter((item) => !item.isNew).map((item) => item.id));
    const query = attributeSearch.value.trim().toLocaleLowerCase("id");
    const available = attributeEntries
      .filter((attribute) => !selectedIds.has(attribute.id))
      .filter((attribute) => !query || `${attribute.title} ${attribute.type} ${attribute.summary}`.toLocaleLowerCase("id").includes(query))
      .sort((a, b) => a.title.localeCompare(b.title, "id"));
    attributeSelect.innerHTML = available.length
      ? available.map((attribute) => `<option value="${escapeHtml(attribute.id)}">${safeText(attribute.title)} · ${safeText(attribute.type)}</option>`).join("")
      : '<option value="">Tidak ada atribut yang cocok</option>';
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Baru saja";
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function typeClass(type) {
    return "type-" + String(type).toLowerCase();
  }

  function noteById(id) {
    return notes.find((note) => note.id === id);
  }

  function getRoute() {
    if (location.pathname.startsWith("/admin")) return { page: "admin" };
    const path = location.hash.replace(/^#\/?/, "");
    if (!path) return { page: "home" };
    const parts = path.split("/").map((part) => {
      try { return decodeURIComponent(part); } catch { return ""; }
    });
    if (parts[0] === "attribute" && parts[1]) return { page: "attribute", slug: parts[1] };
    if (parts[0] === "attributes") return { page: "attributes" };
    if (parts[0] === "guide") return { page: "guide" };
    if (parts[0] === "edit" && parts[1]) return { page: "edit", id: parts[1] };
    if (parts[0] === "delete" && parts[1]) return { page: "delete", id: parts[1] };
    if (parts[0] === "all") return { page: "list", title: "Semua cerita", filter: () => true };
    if (parts[0] === "type") {
      const type = parts.slice(1).join("/");
      return { page: "list", title: type, filter: (note) => note.type === type };
    }
    if (parts[0] === "note" && parts[1]) return { page: "note", id: parts[1] };
    if (parts[0] === "playlists") return { page: "playlists" };
    if (parts[0] === "playlist" && parts[1]) return { page: "playlist", slug: parts[1] };
    return { page: "home" };
  }

  function searchMatches(note, query) {
    if (!query) return true;
    const parent = noteById(note.parentId);
    const haystack = [
      note.title, note.type, note.summary, note.content,
      ...(note.tags || []),
      ...(note.storyCategories || []),
      note.mainStoryTitle || "",
      ...(note.attributes || []).flatMap((attribute) => [attribute.title, attribute.type, attribute.summary]),
      parent ? parent.title : "",
      ...(note.relations || []).flatMap((relation) => [
        relation.label,
        (noteById(relation.targetId) || {}).title || ""
      ])
    ].join(" ").toLocaleLowerCase("id");
    return haystack.includes(query.toLocaleLowerCase("id"));
  }

  function getFilteredNotes(filter) {
    const query = searchInput.value.trim();
    return notes.filter((note) => filter(note) && (profile || searchMatches(note, query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function cardMarkup(note) {
    const parent = noteById(note.parentId);
    const childCount = notes.filter((item) => item.parentId === note.id).length;
    const summary = note.summary || "Belum ada ringkasan. Buka cerita untuk menambahkan detail.";
    return `<div class="note-card">
      <a class="note-card-main" href="/article/${encodeURIComponent(note.slug)}">
        <div class="card-top"><span class="type-pill ${typeClass(note.type)}">${safeText(note.type)}</span><span class="card-date">${formatDate(note.updatedAt)}</span></div>
        ${storyLabelsMarkup(note)}
        <h3>${safeText(note.title)}</h3>
        <p>${safeText(summary)}</p>
        <div class="card-meta">${parent ? `<span>↳ ${safeText(parent.title)}</span><span class="meta-dot">·</span>` : ""}<span>${childCount} turunan</span>${note.tags.length ? `<span class="meta-dot">·</span><span>${safeText(note.tags[0])}</span>` : ""}</div>
      </a>
      ${note.imageUrl ? `<img class="note-thumbnail" src="${escapeHtml(note.imageUrl)}" alt="" loading="lazy">` : ""}
      <div class="card-admin-actions">
        <button class="button button-quiet" type="button" data-action="edit" data-id="${escapeHtml(note.id)}">Ubah</button>
        <button class="button button-quiet" type="button" data-action="delete" data-id="${escapeHtml(note.id)}">Hapus</button>
      </div>
    </div>`;
  }

  function adminCardMarkup(note) {
    const parent = noteById(note.parentId);
    const childCount = notes.filter((item) => item.parentId === note.id).length;
    return `<div class="note-card">
      <a class="note-card-main" ${note.visibility === "published" ? `href="/article/${encodeURIComponent(note.slug)}"` : 'href="/admin"'} data-id="${escapeHtml(note.id)}">
        <div class="card-top"><span class="type-pill ${typeClass(note.type)}">${safeText(note.type)}</span><span class="card-date">${note.visibility === "published" ? "Terbit" : "Draf"} · ${formatDate(note.updatedAt)}</span></div>
        ${storyLabelsMarkup(note)}
        <h3>${safeText(note.title)}</h3>
        <p>${safeText(note.summary || "Belum ada ringkasan.")}</p>
        <div class="card-meta">${parent ? `<span>↳ ${safeText(parent.title)}</span><span class="meta-dot">·</span>` : ""}<span>${childCount} turunan</span></div>
      </a>
      ${note.imageUrl ? `<img class="note-thumbnail" src="${escapeHtml(note.imageUrl)}" alt="" loading="lazy">` : ""}
      <div class="card-admin-actions"><button class="button button-quiet" type="button" data-action="edit" data-id="${escapeHtml(note.id)}">Edit</button><button class="button button-quiet" type="button" data-action="delete" data-id="${escapeHtml(note.id)}">Hapus</button></div>
    </div>`;
  }

  function storyLabelsMarkup(note) {
    const categories = note.storyCategories.map((category) => `<span class="tag">${safeText(category)}</span>`).join("");
    const hidden = note.isHiddenStory ? '<span class="tag hidden-story-tag">Lore rahasia</span>' : "";
    return categories || hidden ? `<div class="card-story-labels">${categories}${hidden}</div>` : "";
  }

  function emptyMarkup(title, message) {
    return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">▤</div><h3>${title}</h3><p>${message}</p><button class="button button-primary" type="button" data-action="add">＋ Tulis cerita</button></div>`;
  }

  function attributeCardMarkup(attribute) {
    const admin = Boolean(profile);
    const isDraft = admin && attribute.visibility === "draft";
    const content = `<div class="card-top"><span class="type-pill ${typeClass(attribute.type)}">${safeText(attribute.type)}</span><span class="card-date">${isDraft ? "Draf · " : ""}${Number(attribute.storyCount) || 0} cerita terkait</span></div>
      <h3>${safeText(attribute.title)}</h3>
      <p>${safeText(attribute.summary || "Buka artikel untuk membaca deskripsi.")}</p>`;
    const main = isDraft
      ? `<button class="note-card-main attribute-card-main" type="button" data-action="edit-attribute" data-id="${escapeHtml(attribute.id)}">${content}</button>`
      : `<a class="note-card-main" href="/#/attribute/${encodeURIComponent(attribute.slug)}">${content}</a>`;
    const editButton = `<div class="card-admin-actions">    <button class="button button-quiet" type="button" data-action="edit-attribute" data-id="${escapeHtml(attribute.id)}">Ubah</button><button class="button button-quiet" type="button" data-action="delete-attribute" data-id="${escapeHtml(attribute.id)}">Hapus</button></div>`;
    return `<article class="note-card attribute-card">
      ${main}
      ${editButton}
    </article>`;
  }

  function renderAttributeList() {
    const query = searchInput.value.trim().toLocaleLowerCase("id");
    const entries = attributeEntries.filter((attribute) => !query
      || `${attribute.title} ${attribute.type} ${attribute.summary}`.toLocaleLowerCase("id").includes(query));
    pageContent.innerHTML = `
      <div class="page-heading">
        <div><div class="eyebrow">LUCIMON LIBRARY · ARTIKEL MANDIRI</div><h1>Atribut</h1><p>Artikel tentang karakter, dunia, konsep, tempat, dan hal lain. Bisa diterbitkan sendiri, lalu ditautkan ke cerita bila perlu.</p></div>
        <button class="button button-primary" type="button" data-action="create-attribute">＋ Tulis atribut</button>
      </div>
      ${entries.length ? `<div class="note-grid">${entries.map(attributeCardMarkup).join("")}</div>` : `<div class="empty-state"><h3>${query ? "Belum ada yang cocok" : "Belum ada atribut terbit"}</h3><p>${query ? "Coba kata lain." : "Buat dan terbitkan artikel karakter, dunia, konsep, atau entri mandiri lainnya."}</p><button class="button button-primary" type="button" data-action="create-attribute">＋ Tulis atribut</button></div>`}`;
  }

  async function renderGuide() {
    pageContent.innerHTML = '<div class="empty-state"><h3>Membuka panduan…</h3></div>';
    try {
      const response = await fetch("/guide-content.html");
      if (!response.ok) throw new Error(`Panduan gagal dimuat (${response.status}).`);
      const content = await response.text();
      if (getRoute().page === "guide") pageContent.innerHTML = content;
    } catch (error) {
      console.error("Gagal memuat panduan:", error);
      if (getRoute().page === "guide") {
        pageContent.innerHTML = '<div class="empty-state server-error"><h3>Panduan belum dapat dibuka</h3><p>Muat ulang halaman atau coba lagi nanti.</p></div>';
      }
    }
  }

  function renderHome() {
    const recent = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
    const worlds = notes.filter((note) => note.type === "Dunia").length;
    const characters = notes.filter((note) => note.type === "Karakter").length;
    const roots = notes.filter((note) => !note.parentId || !noteById(note.parentId)).length;
    pageContent.innerHTML = `
      <section class="home-hero">
        <span class="hero-spark" aria-hidden="true">✦</span>
        <div class="eyebrow">PORTAL CERITA &amp; GAGASAN</div>
        <h1>Selamat datang di Lucimon Library.</h1>
        <p>Ruang untuk cerita dan artikel mandiri tentang karakter, dunia, konsep, serta gagasan lainnya. Siapa pun bisa menulis dan menerbitkan tanpa akun.</p>
        <div class="hero-actions"><button class="button button-primary" type="button" data-action="add">＋ Tulis cerita baru</button><button class="button button-quiet" type="button" data-action="create-attribute">＋ Tulis artikel mandiri</button><a class="hero-link" href="#/all">Jelajahi semua cerita <span aria-hidden="true">→</span></a><a class="hero-link" href="#/attributes">Jelajahi atribut</a><a class="hero-link" href="#/playlists">Jelajahi playlist</a></div>
      </section>
      <section class="stats-row" aria-label="Ringkasan perpustakaan">
        <div class="stat-card"><span class="stat-icon">▤</span><div><strong>${notes.length}</strong><span>cerita tersimpan</span></div></div>
        <div class="stat-card"><span class="stat-icon">◇</span><div><strong>${worlds}</strong><span>dunia cerita</span></div></div>
        <div class="stat-card"><span class="stat-icon">⌘</span><div><strong>${roots}</strong><span>cerita utama · ${characters} karakter</span></div></div>
      </section>
      <section>
        <div class="section-heading"><h2>Cerita terbaru</h2><a class="text-link" href="#/all">Lihat semua <span aria-hidden="true">→</span></a></div>
        ${recent.length ? `<div class="note-grid">${recent.map(cardMarkup).join("")}</div>` : emptyMarkup("Mulai dari satu ide", "Tulis cerita pertamamu, lalu hubungkan dengan cerita lain menggunakan relasi dan atribut.")}
      </section>`;
  }

  function renderList(route) {
    const result = getFilteredNotes(route.filter);
    const query = searchInput.value.trim();
    const title = query ? `Hasil untuk “${escapeHtml(query)}”` : escapeHtml(route.title);
    pageContent.innerHTML = `
      <div class="page-heading">
        <div><div class="eyebrow">LUCIMON LIBRARY · CERITA</div><h1>${title}</h1><p>${query ? "Cari judul, isi, tag, atribut, dan relasi cerita." : "Jelajahi cerita berdasarkan hubungan dan jenisnya."}</p></div>
        <span class="result-count">${result.length} cerita</span>
      </div>
      ${result.length ? `<div class="note-grid">${result.map(cardMarkup).join("")}</div>` : emptyMarkup(query ? "Belum ada yang cocok" : "Bagian ini masih kosong", query ? "Coba kata lain atau periksa ejaan judul dan tag." : "Cerita yang kamu buat akan muncul di sini.")}`;
  }

  function renderPlaylists() {
    const hasStories = notes.some((note) => note.visibility === "published");
    pageContent.innerHTML = `
      <div class="page-heading">
        <div><div class="eyebrow">LUCIMON LIBRARY · PLAYLIST</div><h1>Playlist cerita</h1><p>Kumpulan cerita dalam urutan yang kamu tentukan.</p></div>
        <button class="button button-primary" type="button" data-action="create-playlist" ${hasStories ? "" : "disabled"}>＋ Buat playlist</button>
      </div>
      ${playlists.length ? `<div class="playlist-grid">${playlists.map((playlist) => `
        <article class="playlist-card">
          <a href="/#/playlist/${encodeURIComponent(playlist.slug)}"><h3>${safeText(playlist.title)}</h3></a>
          <p>${safeText(playlist.description || "Belum ada deskripsi.")}</p>
          <small>${playlist.storyCount} cerita · Diperbarui ${formatDate(playlist.updatedAt)}</small>
        </article>`).join("")}</div>` : `<div class="empty-state"><h3>Belum ada playlist</h3><p>${hasStories ? "Buat kumpulan cerita pertama dan tentukan urutannya." : "Terbitkan setidaknya satu cerita sebelum membuat playlist."}</p><button class="button button-primary" type="button" data-action="create-playlist" ${hasStories ? "" : "disabled"}>＋ Buat playlist</button></div>`}`;
  }

  async function renderAttributeDetail(slug) {
    const requestId = ++playlistRenderSequence;
    pageContent.innerHTML = '<div class="empty-state"><h3>Membuka artikel…</h3><p>Memuat atribut dan cerita yang terhubung.</p></div>';
    try {
      const attribute = await api(`/api/public/attributes/${encodeURIComponent(slug)}`);
      if (requestId !== playlistRenderSequence) return;
      pageContent.innerHTML = `
        <nav class="detail-breadcrumb" aria-label="Jejak navigasi"><a href="/">Beranda</a><span>/</span><span>Atribut</span><span>/</span><span>${safeText(attribute.title)}</span></nav>
        <article class="attribute-detail">
          <header class="detail-header">
            <span class="type-pill ${typeClass(attribute.type)}">${safeText(attribute.type)}</span>
            <h1>${safeText(attribute.title)}</h1>
            ${attribute.summary ? `<p class="detail-summary">${safeText(attribute.summary)}</p>` : ""}
            <div class="detail-actions">
              <button class="button button-quiet" type="button" data-action="edit-attribute" data-id="${escapeHtml(attribute.id)}">Ubah artikel</button>
              <button class="button button-quiet" type="button" data-action="delete-attribute" data-id="${escapeHtml(attribute.id)}">Hapus artikel</button>
            </div>
          </header>
          <div class="detail-content">${attribute.content || '<p class="relation-empty">Belum ada deskripsi.</p>'}</div>
          <section>
            <div class="section-heading"><h2>Cerita yang ditautkan</h2><span class="result-count">${attribute.stories.length} cerita</span></div>
            ${attribute.stories.length ? `<div class="note-grid">${attribute.stories.map((story) => `
              <article class="note-card"><a class="note-card-main" href="/article/${encodeURIComponent(story.slug)}">
                <div class="card-top"><span class="type-pill ${typeClass(story.type)}">${safeText(story.type)}</span></div>
                <h3>${safeText(story.title)}</h3><p>${safeText(story.summary || "Buka cerita untuk membaca detail.")}</p>
              </a></article>`).join("")}</div>` : '<div class="empty-state"><h3>Artikel mandiri</h3><p>Belum ada cerita yang ditautkan. Artikel ini tetap dapat dibaca dan diterbitkan secara mandiri.</p></div>'}
          </section>
        </article>
        <a class="back-link" href="#/attributes">← Kembali ke atribut</a>`;
    } catch (error) {
      if (requestId !== playlistRenderSequence) return;
      pageContent.innerHTML = `<div class="empty-state"><h3>Artikel tidak dapat dibuka</h3><p>${safeText(error.message)}</p><a class="back-link" href="#/attributes">← Kembali ke atribut</a></div>`;
    }
  }

  async function renderPlaylistDetail(slug) {
    const requestId = ++playlistRenderSequence;
    pageContent.innerHTML = '<div class="empty-state"><h3>Membuka playlist…</h3><p>Memuat cerita dalam playlist.</p></div>';
    try {
      const playlist = await api(`/api/public/playlists/${encodeURIComponent(slug)}`);
      if (requestId !== playlistRenderSequence) return;
      pageContent.innerHTML = `
        <div class="page-heading">
          <div><div class="eyebrow">PLAYLIST · ${playlist.stories.length} CERITA</div><h1>${safeText(playlist.title)}</h1><p>${safeText(playlist.description)}</p></div>
          <div class="playlist-page-actions">
            <button class="button button-quiet" type="button" data-action="edit-playlist" data-id="${escapeHtml(playlist.id)}">Ubah</button>
          </div>
        </div>
        ${playlist.stories.length ? `<ol class="playlist-items-list">${playlist.stories.map((story) => `
          <li class="playlist-item-row"><strong>${safeText(story.title)}</strong><a class="button button-quiet" href="/article/${encodeURIComponent(story.slug)}">Buka cerita</a></li>`).join("")}</ol>` : '<div class="empty-state"><h3>Playlist kosong</h3><p>Tambahkan cerita untuk mulai menyusun urutan.</p></div>'}
        <a class="back-link" href="/#/playlists">← Semua playlist</a>`;
    } catch (error) {
      if (requestId !== playlistRenderSequence) return;
      pageContent.innerHTML = `<div class="empty-state"><h3>Playlist tidak dapat dibuka</h3><p>${safeText(error.message)}</p><a class="back-link" href="/#/playlists">← Semua playlist</a></div>`;
    }
  }

  function renderNote(id) {
    const note = noteById(id);
    if (!note) {
      pageContent.innerHTML = `<div class="not-found">${emptyMarkup("Cerita tidak ditemukan", "Cerita ini mungkin sudah dihapus.")}<a class="back-link" href="#/all">← Kembali ke perpustakaan</a></div>`;
      return;
    }
    if (note.visibility === "published") location.replace(`/article/${encodeURIComponent(note.slug)}`);
    else pageContent.innerHTML = `<div class="empty-state"><h3>Cerita ini masih draf</h3><p>Cerita draf hanya dapat dibuka dari pengelola.</p><button class="button button-primary" type="button" data-action="edit" data-id="${escapeHtml(note.id)}">Edit cerita</button></div>`;
  }

  async function renderEditRoute(id, requireEditRoute = false) {
    let note = noteById(id);
    if (!note || (!profile && note.visibility !== "published")) {
      pageContent.innerHTML = emptyMarkup("Artikel tidak dapat diubah", "Artikel mungkin sudah dihapus atau tidak lagi diterbitkan.");
      return;
    }
    pageContent.innerHTML = `<a class="back-link" href="${note.visibility === "published" ? `/article/${encodeURIComponent(note.slug)}` : "/admin"}">← Kembali ke artikel</a>`;
    try {
      if (!profile) note = normalizeNote(await api(`/api/public/articles/${encodeURIComponent(id)}`));
      if (!requireEditRoute || (getRoute().page === "edit" && getRoute().id === id)) {
        openEditor(note, false, !profile);
      }
    } catch (error) {
      console.error("Gagal memuat artikel untuk diubah:", error);
      pageContent.innerHTML = `<div class="empty-state"><h3>Artikel tidak dapat diubah</h3><p>${safeText(error.message)}</p></div>`;
    }
  }

  function renderAdmin() {
    const result = getFilteredNotes(() => true);
    pageContent.innerHTML = `
      <section class="home-hero">
        <div class="eyebrow">RUANG PENGELOLA</div>
        <h1>Kelola Lucimon Library.</h1>
        <p>Cerita draf hanya terlihat di sini. Kamu juga dapat mengelola kiriman cerita publik.</p>
        <form id="profile-form" class="profile-form">
          <label class="field-label" for="profile-name">Nama profil</label>
          <div class="profile-row"><input class="text-field" id="profile-name" name="displayName" maxlength="60" required value="${safeText(profile.displayName)}"><button class="button button-quiet" type="submit">Simpan profil</button></div>
          <small class="field-hint">${safeText(profile.email)} · dilindungi Cloudflare Access</small>
        </form>
        <div class="hero-actions"><button class="button button-primary" type="button" data-action="add">＋ Tulis cerita baru</button><a class="hero-link" href="/cdn-cgi/access/logout?returnTo=${encodeURIComponent(location.origin + "/")}">Keluar</a></div>
      </section>
      <section>
        <div class="section-heading"><h2>Cerita tersimpan</h2><span class="result-count">${result.length} cerita</span></div>
        ${result.length ? `<div class="note-grid">${result.map(adminCardMarkup).join("")}</div>` : emptyMarkup("Belum ada cerita", "Buat cerita pertama, lalu hubungkan dengan cerita lain.")}
      </section>`;
    pageContent.insertAdjacentHTML("beforeend", `
      <section class="admin-attributes-section">
        <div class="section-heading"><h2>Artikel atribut</h2><button class="button button-primary" type="button" data-action="create-attribute">＋ Tulis atribut</button></div>
        <p class="field-hint">Kelola artikel mandiri tentang karakter, dunia, konsep, dan entri lain. Artikel terbit bisa ditautkan ke satu atau beberapa cerita.</p>
        ${attributeEntries.length ? `<div class="note-grid">${attributeEntries.map(attributeCardMarkup).join("")}</div>` : '<div class="empty-state"><h3>Belum ada artikel atribut</h3><p>Buat artikel mandiri atau tambahkan entri dari editor cerita.</p></div>'}
      </section>`);
    document.getElementById("profile-form").addEventListener("submit", saveProfile);
  }

  function render() {
    if (!isReady) return;
    const route = getRoute();
    document.getElementById("note-count").textContent = String(notes.length);
    document.getElementById("topbar-context").textContent = route.page === "admin" ? "RUANG PENGELOLA" : route.page === "guide" ? "PANDUAN PENGGUNA" : route.page === "playlists" || route.page === "playlist" ? "PLAYLIST CERITA" : route.page === "attribute" || route.page === "attributes" ? "ARTIKEL ATRIBUT" : "PORTAL CERITA & GAGASAN";
    document.getElementById("admin-link").textContent = profile ? "Beranda" : "Masuk";
    document.getElementById("admin-link").href = profile ? "/" : "/admin";
    document.querySelector(".backup-menu").hidden = !profile;
    document.getElementById("add-button").textContent = profile ? "＋ Cerita baru" : "＋ Tulis cerita";
    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("active",
        (route.page === "home" && link.dataset.nav === "home")
        || (route.page === "list" && route.title === "Semua cerita" && link.dataset.nav === "all")
        || ((route.page === "attributes" || route.page === "attribute") && link.dataset.nav === "attributes")
        || (route.page === "guide" && link.dataset.nav === "guide")
        || ((route.page === "playlists" || route.page === "playlist") && link.dataset.nav === "playlists"));
    });
    if (route.page === "admin") renderAdmin();
    else if (route.page === "home") renderHome();
    else if (route.page === "note") renderNote(route.id);
    else if (route.page === "attributes") renderAttributeList();
    else if (route.page === "attribute") renderAttributeDetail(route.slug);
    else if (route.page === "guide") renderGuide();
    else if (route.page === "edit") renderEditRoute(route.id, true);
    else if (route.page === "delete") {
      pageContent.innerHTML = '<div class="empty-state"><h3>Memproses penghapusan…</h3></div>';
      deleteNote(route.id);
    }
    else if (route.page === "playlists") renderPlaylists();
    else if (route.page === "playlist") renderPlaylistDetail(route.slug);
    else renderList(route);
  }

  function releasePreviewUrl() {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }

  function setImagePreview(url) {
    if (!url) {
      imagePreview.removeAttribute("src");
      imagePreviewWrap.hidden = true;
      return;
    }
    imagePreview.src = url;
    imagePreviewWrap.hidden = false;
  }

  function openEditor(note, publicSubmission = false, publicEdit = false) {
    form.reset();
    releasePreviewUrl();
    pendingImage = null;
    removeImage = false;
    isPublicSubmission = publicSubmission;
    isPublicEdit = publicEdit;
    adminOnlyFields.forEach((field) => { field.hidden = publicSubmission || publicEdit; });
    publicPublicationNotice.hidden = !publicSubmission && !publicEdit;
    document.getElementById("public-publication-message").textContent = publicEdit
      ? "Artikel terbit ini dapat diubah siapa pun. Perubahan langsung terlihat oleh semua orang."
      : "Cerita langsung terlihat oleh semua orang. Kiriman tanpa akun tidak mendukung unggahan gambar.";
    fieldRow.classList.toggle("public-submission", publicSubmission || publicEdit);
    imageUrl = note ? note.imageUrl : "";
    document.getElementById("field-id").value = note ? note.id : "";
    document.getElementById("dialog-title").textContent = publicSubmission ? "Tulis cerita publik" : publicEdit ? "Ubah cerita terbit" : note ? "Edit cerita" : "Cerita baru";
    document.getElementById("field-title").value = note ? note.title : "";
    document.getElementById("field-type").value = note ? note.type : "Catatan";
    document.getElementById("field-visibility").value = publicSubmission ? "published" : note ? note.visibility : "draft";
    document.getElementById("field-summary").value = note ? note.summary : "";
    contentEditor.innerHTML = note ? contentForEditor(note.content) : "";
    document.getElementById("field-tags").value = note ? note.tags.join(", ") : "";
    relatedSearch.value = "";
    selectedRelatedIds = new Set(note ? note.relations.map((relation) => relation.targetId) : []);
    selectedRelationLabels = new Map(note ? note.relations.map((relation) => [relation.targetId, relation.label]) : []);
    selectedAttributes = note ? note.attributes.map((attribute) => ({ ...attribute, isNew: false })) : [];
    document.getElementById("new-attribute-form").hidden = true;
    document.getElementById("attribute-title").value = "";
    document.getElementById("attribute-summary").value = "";
    document.getElementById("attribute-content").value = "";
    attributeSearch.value = "";
    renderAttributeRows();
    setImagePreview(imageUrl);

    const parentSelect = document.getElementById("field-parent");
    const available = notes.filter((item) => !note || item.id !== note.id);
    parentSelect.innerHTML = '<option value="">Tidak ada (cerita utama)</option>' +
      available.map((item) => `<option value="${escapeHtml(item.id)}">${safeText(item.title)}</option>`).join("");
    parentSelect.value = note ? note.parentId : "";
    const mainStorySelect = document.getElementById("field-main-story");
    mainStorySelect.innerHTML = '<option value="">Tidak ditautkan ke cerita utama tertentu</option>' +
      available.map((item) => `<option value="${escapeHtml(item.id)}">${safeText(item.title)}${item.storyCategories.length ? ` · ${safeText(item.storyCategories.join(", "))}` : ""}</option>`).join("");
    mainStorySelect.value = note ? note.mainStoryId : "";
    const storyCategories = note && note.storyCategories.length ? note.storyCategories : ["Canon"];
    form.querySelectorAll('input[name="storyCategories"]').forEach((input) => {
      input.checked = storyCategories.includes(input.value);
    });
    document.getElementById("field-hidden-story").checked = Boolean(note && note.isHiddenStory);
    renderRelatedOptions();
    document.getElementById("save-button").textContent = publicSubmission ? "Terbitkan cerita" : publicEdit ? "Simpan perubahan" : "Simpan cerita";
    dialog.showModal();
    document.getElementById("field-title").focus();
  }

  function openAttributeEditor(attribute = null) {
    attributeForm.reset();
    document.getElementById("attribute-field-id").value = attribute ? attribute.id : "";
    document.getElementById("attribute-dialog-title").textContent = attribute ? "Edit artikel atribut" : "Artikel atribut baru";
    document.getElementById("standalone-attribute-title").value = attribute ? attribute.title : "";
    document.getElementById("standalone-attribute-type").value = attribute ? attribute.type : "Karakter";
    document.getElementById("standalone-attribute-visibility").value = attribute ? attribute.visibility : "draft";
    document.getElementById("standalone-attribute-summary").value = attribute ? attribute.summary : "";
    document.getElementById("standalone-attribute-content").value = attribute ? attribute.content || "" : "";
    document.getElementById("attribute-publication-notice").hidden = Boolean(profile);
    attributeForm.querySelectorAll("[data-attribute-admin-only]").forEach((field) => { field.hidden = !profile; });
    document.getElementById("save-attribute-button").textContent = profile
      ? "Simpan artikel"
      : attribute ? "Simpan perubahan" : "Terbitkan artikel";
    attributeDialog.showModal();
    document.getElementById("standalone-attribute-title").focus();
  }

  async function editAttribute(id) {
    const attribute = attributeEntries.find((item) => item.id === id);
    if (!attribute || (!profile && attribute.visibility !== "published")) return;
    try {
      const editable = profile
        ? attribute
        : await api(`/api/public/attributes/${encodeURIComponent(attribute.slug)}`);
      openAttributeEditor(editable);
    } catch (error) {
      console.error("Gagal memuat artikel atribut untuk diubah:", error);
      showToast(error.message);
    }
  }

  async function saveAttributeFromForm(event) {
    event.preventDefault();
    const saveButton = document.getElementById("save-attribute-button");
    saveButton.disabled = true;
    saveButton.textContent = "Menyimpan…";
    try {
      const id = document.getElementById("attribute-field-id").value;
      const entry = await api(id
        ? `${profile ? "/api/admin/attributes" : "/api/public/attributes"}/${encodeURIComponent(id)}`
        : profile ? "/api/admin/attributes" : "/api/public/attributes", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          title: document.getElementById("standalone-attribute-title").value.trim(),
          type: document.getElementById("standalone-attribute-type").value,
          visibility: profile ? document.getElementById("standalone-attribute-visibility").value : "published",
          summary: document.getElementById("standalone-attribute-summary").value.trim(),
          content: document.getElementById("standalone-attribute-content").value
        })
      });
      attributeDialog.close();
      await refreshNotes();
      showToast(id
        ? "Artikel atribut diperbarui."
        : entry.visibility === "published" ? "Artikel atribut diterbitkan." : "Artikel atribut disimpan sebagai draf.");
    } catch (error) {
      console.error("Gagal menyimpan artikel atribut:", error);
      showToast(error.message);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = profile
        ? "Simpan artikel"
        : document.getElementById("attribute-field-id").value ? "Simpan perubahan" : "Terbitkan artikel";
    }
  }

  async function deleteAttribute(id) {
    const attribute = attributeEntries.find((item) => item.id === id);
    if (!attribute) return;
    const storyCount = Number(attribute.storyCount) || 0;
    const confirmation = storyCount
      ? `Hapus artikel atribut “${attribute.title}” secara permanen? Artikel ini akan dilepas dari ${storyCount} cerita. Ceritanya tidak ikut dihapus.`
      : `Hapus artikel atribut “${attribute.title}” secara permanen?`;
    if (!window.confirm(confirmation)) return;
    try {
      await api(`${profile ? "/api/admin/attributes" : "/api/public/attributes"}/${encodeURIComponent(id)}`, { method: "DELETE" });
      attributeEntries = attributeEntries.filter((item) => item.id !== id);
      notes = notes.map((note) => ({
        ...note,
        attributes: note.attributes.filter((item) => item.id !== id)
      }));
      if (getRoute().page === "attribute") location.hash = "#/attributes";
      render();
      showToast("Artikel atribut dihapus.");
    } catch (error) {
      console.error("Gagal menghapus artikel atribut:", error);
      showToast(error.message);
    }
  }

  function renderPlaylistItems() {
    const list = document.getElementById("playlist-items-list");
    list.innerHTML = playlistItemIds.map((id, index) => {
      const story = noteById(id);
      if (!story) return "";
      return `<li class="playlist-item-row">
        <strong>${index + 1}. ${safeText(story.title)}</strong>
        <div class="playlist-item-actions">
          <button class="button button-quiet playlist-item-action" type="button" data-action="playlist-up" data-index="${index}" aria-label="Pindah ke atas" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="button button-quiet playlist-item-action" type="button" data-action="playlist-down" data-index="${index}" aria-label="Pindah ke bawah" ${index === playlistItemIds.length - 1 ? "disabled" : ""}>↓</button>
          <button class="button button-quiet playlist-item-action" type="button" data-action="playlist-remove" data-index="${index}" aria-label="Hapus dari playlist">×</button>
        </div>
      </li>`;
    }).join("");
  }

  function openPlaylistEditor(playlist = null) {
    editingPlaylistId = playlist ? playlist.id : "";
    playlistItemIds = playlist ? playlist.stories.map((story) => story.id) : [];
    document.getElementById("playlist-dialog-title").textContent = playlist ? "Ubah playlist" : "Playlist baru";
    document.getElementById("playlist-title").value = playlist ? playlist.title : "";
    document.getElementById("playlist-description").value = playlist ? playlist.description : "";
    const storySelect = document.getElementById("playlist-story-select");
    const availableStories = notes.filter((note) => note.visibility === "published");
    storySelect.innerHTML = availableStories.length
      ? availableStories.map((story) => `<option value="${escapeHtml(story.id)}">${safeText(story.title)}</option>`).join("")
      : '<option value="">Belum ada cerita terbit</option>';
    renderPlaylistItems();
    playlistDialog.showModal();
    document.getElementById("playlist-title").focus();
  }

  async function editPlaylist(id) {
    const playlist = playlists.find((item) => item.id === id);
    if (!playlist) return;
    try {
      const detail = await api(`/api/public/playlists/${encodeURIComponent(playlist.slug)}`);
      openPlaylistEditor(detail);
    } catch (error) {
      console.error("Gagal memuat playlist:", error);
      showToast(error.message);
    }
  }

  async function savePlaylist(event) {
    event.preventDefault();
    const saveButton = document.getElementById("save-playlist-button");
    saveButton.disabled = true;
    saveButton.textContent = "Menyimpan…";
    try {
      if (!playlistItemIds.length) throw new Error("Tambahkan minimal satu cerita ke playlist.");
      const playlist = await api(
        editingPlaylistId ? `/api/public/playlists/${encodeURIComponent(editingPlaylistId)}` : "/api/public/playlists",
        {
          method: editingPlaylistId ? "PUT" : "POST",
          body: JSON.stringify({
            title: document.getElementById("playlist-title").value.trim(),
            description: document.getElementById("playlist-description").value.trim(),
            articleIds: playlistItemIds
          })
        }
      );
      playlists = await api("/api/public/playlists");
      playlistDialog.close();
      showToast(editingPlaylistId ? "Playlist diperbarui." : "Playlist diterbitkan.");
      const route = getRoute();
      if (route.page === "playlist") renderPlaylistDetail(playlist.slug);
      else if (route.page === "playlists") renderPlaylists();
    } catch (error) {
      console.error("Gagal menyimpan playlist:", error);
      showToast(error.message);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Terbitkan playlist";
    }
  }

  function hasParentCycle(noteId, parentId) {
    let current = parentId;
    const visited = new Set();
    while (current) {
      if (current === noteId || visited.has(current)) return true;
      visited.add(current);
      const item = noteById(current);
      current = item ? item.parentId : "";
    }
    return false;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Gambar gagal dibaca."));
      reader.readAsDataURL(file);
    });
  }

  async function saveFromForm(event) {
    event.preventDefault();
    const saveButton = document.getElementById("save-button");
    saveButton.disabled = true;
    saveButton.textContent = "Menyimpan…";
    const oldId = document.getElementById("field-id").value;
    const oldNote = noteById(oldId);
    let uploadedImageKey = "";

    try {
      const formData = new FormData(form);
      const parentId = String(formData.get("parentId") || "");
      if (oldId && hasParentCycle(oldId, parentId)) throw new Error("Hubungan parent tidak boleh membentuk lingkaran.");

      let nextImageUrl = removeImage ? "" : imageUrl;
      let nextImageKey = removeImage ? "" : (oldNote ? oldNote.imageKey : "");
      if (pendingImage) {
        const data = await readFileAsDataUrl(pendingImage);
        const uploaded = await api("/api/admin/images", {
          method: "POST",
          body: JSON.stringify({ mime: pendingImage.type, data })
        });
        uploadedImageKey = uploaded.imageKey;
        nextImageKey = uploaded.imageKey;
        nextImageUrl = uploaded.imageUrl;
      }

      const note = {
        title: String(formData.get("title") || "").trim(),
        type: TYPES.includes(String(formData.get("type"))) ? String(formData.get("type")) : "Catatan",
        visibility: String(formData.get("visibility")) === "published" ? "published" : "draft",
        summary: String(formData.get("summary") || "").trim(),
        content: serializeEditorContent(),
        parentId,
        mainStoryId: String(formData.get("mainStoryId") || ""),
        storyCategories: Array.from(form.querySelectorAll('input[name="storyCategories"]:checked'))
          .map((input) => input.value),
        isHiddenStory: document.getElementById("field-hidden-story").checked,
        relations: Array.from(selectedRelatedIds)
          .filter((targetId) => targetId !== oldId)
          .map((targetId) => ({ targetId, label: selectedRelationLabels.get(targetId) || "" })),
        relatedIds: Array.from(selectedRelatedIds).filter((targetId) => targetId !== oldId),
        attributes: selectedAttributes.map((attribute) => attribute.isNew
          ? {
            title: attribute.title,
            type: attribute.type,
            summary: attribute.summary,
            content: attribute.content
          }
          : { id: attribute.id }),
        tags: String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        imageKey: nextImageKey,
        imageUrl: nextImageUrl
      };
      if (isPublicSubmission) {
        note.visibility = "published";
        note.parentId = "";
        note.imageKey = "";
        note.imageUrl = "";
      }
      const endpoint = oldId
        ? `${isPublicEdit ? "/api/public/articles" : "/api/admin/articles"}/${encodeURIComponent(oldId)}`
        : profile ? "/api/admin/articles" : "/api/public/articles";
      const stored = await api(endpoint, {
        method: oldId ? "PUT" : "POST",
        body: JSON.stringify(note)
      });
      if (isPublicEdit) {
        notes = notes.map((item) => item.id === oldId ? { ...item, ...stored } : item);
        dialog.close();
        window.location.assign(`/article/${encodeURIComponent(stored.slug)}`);
        return;
      }
      const previousImageKey = oldNote ? oldNote.imageKey : "";
      const savedAttributeIds = new Set((stored.attributes || []).map((attribute) => attribute.id));
      const previousAttributeIds = new Set((oldNote?.attributes || []).map((attribute) => attribute.id));
      if (oldNote) {
        attributeEntries = attributeEntries.flatMap((attribute) => {
          if (!previousAttributeIds.has(attribute.id) || savedAttributeIds.has(attribute.id)) {
            return [attribute];
          }
          const storyCount = Math.max(0, Number(attribute.storyCount) - 1);
          return profile || storyCount > 0 ? [{ ...attribute, storyCount }] : [];
        });
      }
      for (const attribute of stored.attributes || []) {
        const index = attributeEntries.findIndex((entry) => entry.id === attribute.id);
        const storyCount = index >= 0
          ? Number(attributeEntries[index].storyCount) + (previousAttributeIds.has(attribute.id) ? 0 : 1)
          : 1;
        if (index >= 0) attributeEntries[index] = { ...attributeEntries[index], ...attribute, storyCount };
        else attributeEntries.push({ ...attribute, storyCount: 1 });
      }
      notes = oldId ? notes.map((item) => item.id === oldId ? normalizeNote(stored) : item) : [normalizeNote(stored), ...notes];
      dialog.close();
      render();
      showToast(isPublicSubmission ? "Cerita berhasil diterbitkan." : oldId ? "Cerita berhasil diperbarui." : "Cerita tersimpan di Lucimon Library.");
      if (previousImageKey && previousImageKey !== nextImageKey) {
        api(`/api/admin/images/${encodeURIComponent(previousImageKey)}`, { method: "DELETE" })
          .catch((error) => { console.error("Gambar lama tidak dapat dibersihkan:", error); showToast("Cerita tersimpan, tetapi gambar lama belum terhapus."); });
      }
    } catch (error) {
      console.error("Gagal menyimpan cerita:", error);
      if (uploadedImageKey) {
        api(`/api/admin/images/${encodeURIComponent(uploadedImageKey)}`, { method: "DELETE" })
          .catch((cleanupError) => console.error("Gambar unggahan sementara tidak dapat dibersihkan:", cleanupError));
      }
      showToast(error.message);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = isPublicSubmission ? "Terbitkan cerita" : isPublicEdit ? "Simpan perubahan" : "Simpan cerita";
    }
  }

  async function deleteNote(id) {
    const note = noteById(id);
    if (!note) return;
    if (!window.confirm(`Hapus artikel “${note.title}” secara permanen? Cerita turunannya akan menjadi cerita utama.`)) {
      if (getRoute().page === "delete") window.location.assign(`/article/${encodeURIComponent(note.slug)}`);
      return;
    }
    try {
      await api(`${profile ? "/api/admin/articles" : "/api/public/articles"}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!profile && getRoute().page === "delete") {
        window.location.assign("/");
        return;
      }
      await refreshNotes();
      render();
      showToast("Cerita dihapus.");
    } catch (error) {
      console.error("Gagal menghapus cerita:", error);
      showToast(error.message);
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const displayName = document.getElementById("profile-name").value.trim();
    try {
      const result = await api("/api/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ displayName })
      });
      profile = result.profile;
      render();
      showToast("Profil berhasil diperbarui.");
    } catch (error) {
      console.error("Gagal menyimpan profil:", error);
      showToast(error.message);
    }
  }

  async function exportBackup() {
    try {
      const backup = await api("/api/admin/export");
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lucimon-library-cadangan-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast("Cadangan artikel dan atribut diunduh. Gambar tetap tersimpan di D1.");
    } catch (error) {
      console.error("Gagal mengekspor cadangan:", error);
      showToast(error.message);
    }
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.articles) ? parsed.articles
          : Array.isArray(parsed.notes) ? parsed.notes
            : Array.isArray(parsed.attributes) ? [] : null;
      const importedAttributes = Array.isArray(parsed) ? [] : Array.isArray(parsed.attributes) ? parsed.attributes : [];
      if (!Array.isArray(imported)) throw new Error("File harus berisi daftar cerita JSON.");
      const validated = imported.map(normalizeNote);
      if (!validated.length && !importedAttributes.length) throw new Error("Cadangan tidak berisi artikel atau atribut.");
      if (!window.confirm(`Impor ${validated.length} cerita dan ${importedAttributes.length} artikel atribut? Jika ID sudah ada, isinya akan ditimpa. Data yang tidak ada di cadangan tidak dihapus; status draf/terbit dipulihkan dari JSON.`)) return;
      const result = await api("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({ articles: validated, attributes: importedAttributes })
      });
      await refreshNotes();
      showToast(`${result.count} cerita dan ${result.attributeCount || 0} artikel atribut diimpor atau diperbarui.${result.skippedImages ? ` ${result.skippedImages} gambar tidak dipindahkan; gambar artikel yang sudah ada dipertahankan.` : ""}`);
    } catch (error) {
      console.error("Gagal mengimpor cadangan:", error);
      showToast(`Impor gagal: ${error.message}`);
    } finally {
      document.getElementById("import-file").value = "";
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || !isReady) return;
    if (target.dataset.action === "add") {
      openEditor(null, !profile);
    }
    if (target.dataset.action === "create-attribute") openAttributeEditor();
    if (target.dataset.action === "edit-attribute") {
      editAttribute(target.dataset.id);
    }
    if (target.dataset.action === "delete-attribute") deleteAttribute(target.dataset.id);
    if (target.dataset.action === "edit") {
      const note = noteById(target.dataset.id);
      if (note && (profile || note.visibility === "published")) {
        if (profile) openEditor(note);
        else renderEditRoute(note.id);
      }
    }
    if (target.dataset.action === "delete") deleteNote(target.dataset.id);
    if (target.dataset.action === "create-playlist") openPlaylistEditor();
    if (target.dataset.action === "edit-playlist") editPlaylist(target.dataset.id);
    if (target.dataset.action === "playlist-remove") {
      playlistItemIds.splice(Number(target.dataset.index), 1);
      renderPlaylistItems();
    }
    if (target.dataset.action === "playlist-up" || target.dataset.action === "playlist-down") {
      const index = Number(target.dataset.index);
      const offset = target.dataset.action === "playlist-up" ? -1 : 1;
      const nextIndex = index + offset;
      if (nextIndex >= 0 && nextIndex < playlistItemIds.length) {
        [playlistItemIds[index], playlistItemIds[nextIndex]] = [playlistItemIds[nextIndex], playlistItemIds[index]];
        renderPlaylistItems();
      }
    }
  });
  document.getElementById("add-button").addEventListener("click", () => {
    if (!isReady) return;
    openEditor(null, !profile);
  });
  document.getElementById("add-attribute-button").addEventListener("click", () => {
    if (isReady) openAttributeEditor();
  });
  document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
  document.getElementById("cancel-dialog").addEventListener("click", () => dialog.close());
  document.getElementById("close-attribute-dialog").addEventListener("click", () => attributeDialog.close());
  document.getElementById("cancel-attribute-dialog").addEventListener("click", () => attributeDialog.close());
  attributeForm.addEventListener("submit", saveAttributeFromForm);
  document.getElementById("close-playlist-dialog").addEventListener("click", () => playlistDialog.close());
  document.getElementById("cancel-playlist-dialog").addEventListener("click", () => playlistDialog.close());
  document.getElementById("add-existing-attribute").addEventListener("click", () => {
    const attribute = attributeEntries.find((item) => item.id === attributeSelect.value);
    if (!attribute || selectedAttributes.some((item) => item.id === attribute.id)) return;
    selectedAttributes.push({ ...attribute, isNew: false });
    renderAttributeRows();
  });
  attributeSearch.addEventListener("input", renderAttributeRows);
  document.getElementById("toggle-new-attribute").addEventListener("click", () => {
    const editor = document.getElementById("new-attribute-form");
    editor.hidden = !editor.hidden;
    if (!editor.hidden) document.getElementById("attribute-title").focus();
  });
  document.getElementById("create-attribute-entry").addEventListener("click", () => {
    const title = document.getElementById("attribute-title").value.trim();
    if (!title) {
      showToast("Nama entri atribut wajib diisi.");
      document.getElementById("attribute-title").focus();
      return;
    }
    selectedAttributes.push({
      clientId: crypto.randomUUID(),
      title,
      type: document.getElementById("attribute-type").value,
      summary: document.getElementById("attribute-summary").value.trim(),
      content: document.getElementById("attribute-content").value.trim(),
      isNew: true
    });
    document.getElementById("attribute-title").value = "";
    document.getElementById("attribute-summary").value = "";
    document.getElementById("attribute-content").value = "";
    document.getElementById("new-attribute-form").hidden = true;
    renderAttributeRows();
  });
  document.getElementById("attributes-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-attribute]");
    if (!button) return;
    selectedAttributes.splice(Number(button.dataset.removeAttribute), 1);
    renderAttributeRows();
  });
  document.getElementById("playlist-add-story").addEventListener("click", () => {
    const storyId = document.getElementById("playlist-story-select").value;
    if (!storyId || playlistItemIds.includes(storyId)) return;
    playlistItemIds.push(storyId);
    renderPlaylistItems();
  });
  document.getElementById("remove-image").addEventListener("click", () => {
    pendingImage = null;
    imageUrl = "";
    removeImage = true;
    imageField.value = "";
    releasePreviewUrl();
    setImagePreview("");
  });
  imageField.addEventListener("change", () => {
    const file = imageField.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 1024 * 1024) {
      imageField.value = "";
      showToast("Pilih gambar JPEG, PNG, WebP, atau GIF berukuran maksimal 1 MB.");
      return;
    }
    releasePreviewUrl();
    pendingImage = file;
    removeImage = false;
    previewObjectUrl = URL.createObjectURL(file);
    setImagePreview(previewObjectUrl);
  });
  relatedOptions.addEventListener("change", (event) => {
    const changed = event.target;
    if (changed.matches(".relation-label-input")) {
      selectedRelationLabels.set(changed.dataset.relationTarget, changed.value);
      return;
    }
    const visibleInputs = Array.from(relatedOptions.querySelectorAll('input[name="relatedIds"]'));
    const visibleIds = new Set(visibleInputs.map((input) => input.value));
    const checkedVisible = visibleInputs.filter((input) => input.checked).map((input) => input.value);
    selectedRelatedIds = new Set([
      ...Array.from(selectedRelatedIds).filter((id) => !visibleIds.has(id)),
      ...checkedVisible
    ]);
    for (const id of visibleIds) {
      if (!selectedRelatedIds.has(id)) selectedRelationLabels.delete(id);
      else if (!selectedRelationLabels.has(id)) selectedRelationLabels.set(id, "");
    }
    for (const input of relatedOptions.querySelectorAll(".relation-label-input")) {
      selectedRelationLabels.set(input.dataset.relationTarget, input.value);
    }
    renderRelatedOptions();
  });
  relatedOptions.addEventListener("input", (event) => {
    if (event.target.matches(".relation-label-input")) {
      selectedRelationLabels.set(event.target.dataset.relationTarget, event.target.value);
    }
  });
  document.getElementById("playlist-form").addEventListener("submit", (event) => {
    event.preventDefault();
    savePlaylist(event);
  });
  relatedSearch.addEventListener("input", () => {
    const visibleIds = new Set(Array.from(relatedOptions.querySelectorAll('input[name="relatedIds"]'))
      .map((input) => input.value));
    const checkedVisible = new Set(Array.from(relatedOptions.querySelectorAll('input[name="relatedIds"]:checked'))
      .map((input) => input.value));
    for (const id of visibleIds) {
      if (checkedVisible.has(id)) selectedRelatedIds.add(id);
      else selectedRelatedIds.delete(id);
    }
    renderRelatedOptions();
  });
  contentEditor.addEventListener("keyup", rememberEditorSelection);
  contentEditor.addEventListener("mouseup", rememberEditorSelection);
  contentEditor.addEventListener("input", rememberEditorSelection);
  document.querySelectorAll(".editor-tool").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => applyEditorCommand(button.dataset.command));
  });
  document.getElementById("editor-block-style").addEventListener("mousedown", rememberEditorSelection);
  document.getElementById("editor-block-style").addEventListener("change", (event) => {
    restoreEditorSelection();
    contentEditor.focus();
    document.execCommand("formatBlock", false, event.target.value);
  });
  form.addEventListener("submit", saveFromForm);
  document.getElementById("export-button").addEventListener("click", exportBackup);
  document.getElementById("import-button").addEventListener("click", () => document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", (event) => importBackup(event.target.files[0]));
  searchInput.addEventListener("input", () => {
    const route = getRoute();
    if (route.page === "note") location.hash = "#/all";
    else if (route.page === "attributes" || route.page === "guide") render();
    else if (profile) render();
    else {
      const requestId = ++searchSequence;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(async () => {
        try {
          const result = await api(publicArticlesUrl(searchInput.value.trim()));
          if (requestId === searchSequence) {
            notes = result.map(normalizeNote);
            render();
          }
        } catch (error) {
          console.error("Pencarian cerita gagal:", error);
          showToast(error.message);
        }
      }, 220);
    }
  });
  window.addEventListener("hashchange", () => {
    const route = getRoute();
    if (route.page === "attribute") renderAttributeDetail(route.slug);
    else render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !dialog.open) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  loadNotes();

  function rememberEditorSelection() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && contentEditor.contains(selection.anchorNode)) {
      savedEditorRange = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreEditorSelection() {
    if (!savedEditorRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedEditorRange);
  }

  function applyEditorCommand(command) {
    restoreEditorSelection();
    contentEditor.focus();
    if (command === "normalText") {
      const selection = window.getSelection();
      document.execCommand("removeFormat", false, null);
      if (selection?.isCollapsed) {
        for (const style of ["bold", "italic", "underline"]) {
          if (document.queryCommandState(style)) document.execCommand(style, false, null);
        }
      }
      document.execCommand("formatBlock", false, "p");
      return;
    }
    if (command === "blockquote") {
      document.execCommand("formatBlock", false, "blockquote");
      return;
    }
    if (command === "createLink") {
      const selectedText = window.getSelection()?.toString();
      if (!selectedText) {
        showToast("Pilih teks yang ingin dijadikan tautan terlebih dahulu.");
        return;
      }
      const value = window.prompt("Masukkan alamat tautan (contoh: https://contoh.com):");
      if (!value) return;
      let url;
      try {
        url = new URL(value.trim(), location.origin);
      } catch {
        showToast("Alamat tautan tidak valid.");
        return;
      }
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
        showToast("Tautan hanya boleh menggunakan http, https, atau email.");
        return;
      }
      document.execCommand("createLink", false, url.href);
      return;
    }
    document.execCommand(command, false, null);
  }
})();
