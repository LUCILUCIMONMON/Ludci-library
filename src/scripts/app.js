(function () {
  "use strict";

  const TYPES = ["Dunia", "Karakter", "Alur", "Tempat", "Catatan"];
  const pageContent = document.getElementById("page-content");
  const searchInput = document.getElementById("search-input");
  const dialog = document.getElementById("note-dialog");
  const form = document.getElementById("note-form");
  const toast = document.getElementById("toast");
  const imageField = document.getElementById("field-image");
  const contentEditor = document.getElementById("field-content");
  const relatedSearch = document.getElementById("related-search");
  const relatedOptions = document.getElementById("related-options");
  const imagePreviewWrap = document.getElementById("image-preview-wrap");
  const imagePreview = document.getElementById("image-preview");
  let notes = [];
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
      throw new Error("Ada artikel dengan format tidak valid.");
    }
    return {
      id: note.id,
      slug: typeof note.slug === "string" ? note.slug : "",
      title: note.title,
      type: TYPES.includes(note.type) ? note.type : "Catatan",
      summary: typeof note.summary === "string" ? note.summary : "",
      content: typeof note.content === "string" ? note.content : "",
      parentId: typeof note.parentId === "string" ? note.parentId : "",
      relatedIds: Array.isArray(note.relatedIds) ? note.relatedIds.filter((id) => typeof id === "string") : [],
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
        notes = (await api("/api/admin/articles")).map(normalizeNote);
      } else {
        profile = null;
        notes = (await api("/api/public/articles")).map(normalizeNote);
      }
      isReady = true;
      render();
    } catch (error) {
      console.error("Gagal memuat Lucimon Library:", error);
      document.getElementById("note-count").textContent = "—";
      if (location.pathname.startsWith("/admin")) {
        const redirect = encodeURIComponent(`${location.origin}/admin`);
        pageContent.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">⌑</div><h3>Login pengelola</h3><p>Masuk dengan akun yang diizinkan Cloudflare Access untuk mengelola artikel.</p><a class="button button-primary" href="/cdn-cgi/access/login?redirect_url=${redirect}">Masuk dengan Cloudflare Access</a></div>`;
      } else {
        pageContent.innerHTML = `<div class="empty-state server-error"><div class="empty-icon" aria-hidden="true">!</div><h3>Perpustakaan belum dapat dibuka</h3><p>Pastikan Worker dan database Cloudflare sudah dikonfigurasi, lalu coba muat ulang halaman.</p></div>`;
      }
      showToast(error.message);
    }
  }

  async function refreshNotes() {
    notes = (await api(profile ? "/api/admin/articles" : "/api/public/articles")).map(normalizeNote);
    render();
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
          <span><strong>${safeText(note.title)}</strong><small>${safeText(note.type)}</small></span>
        </label>`).join("")
      : '<p class="related-empty">Tidak ada artikel yang cocok.</p>';
    const count = selectedRelatedIds.size;
    document.getElementById("related-selected-count").textContent = count
      ? `${count} artikel dipilih.`
      : "Belum ada artikel yang dipilih.";
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
    let path;
    try {
      path = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    } catch {
      path = "";
    }
    const parts = path.split("/");
    if (!parts[0]) return { page: "home" };
    if (parts[0] === "all") return { page: "list", title: "Semua artikel", filter: () => true };
    if (parts[0] === "type") {
      const type = parts.slice(1).join("/");
      return { page: "list", title: type, filter: (note) => note.type === type };
    }
    if (parts[0] === "note" && parts[1]) return { page: "note", id: parts[1] };
    return { page: "home" };
  }

  function searchMatches(note, query) {
    if (!query) return true;
    const parent = noteById(note.parentId);
    const haystack = [
      note.title, note.type, note.summary, note.content,
      ...(note.tags || []),
      parent ? parent.title : "",
      ...(note.relatedIds || []).map((id) => (noteById(id) || {}).title || "")
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
    const summary = note.summary || "Belum ada ringkasan. Buka artikel untuk menambahkan detail.";
    return `<div class="note-card">
      <a class="note-card-main" href="/article/${encodeURIComponent(note.slug)}">
        <div class="card-top"><span class="type-pill ${typeClass(note.type)}">${safeText(note.type)}</span><span class="card-date">${formatDate(note.updatedAt)}</span></div>
        <h3>${safeText(note.title)}</h3>
        <p>${safeText(summary)}</p>
        <div class="card-meta">${parent ? `<span>↳ ${safeText(parent.title)}</span><span class="meta-dot">·</span>` : ""}<span>${childCount} turunan</span>${note.tags.length ? `<span class="meta-dot">·</span><span>${safeText(note.tags[0])}</span>` : ""}</div>
      </a>
      ${note.imageUrl ? `<img class="note-thumbnail" src="${escapeHtml(note.imageUrl)}" alt="" loading="lazy">` : ""}
    </div>`;
  }

  function adminCardMarkup(note) {
    const parent = noteById(note.parentId);
    const childCount = notes.filter((item) => item.parentId === note.id).length;
    return `<div class="note-card">
      <a class="note-card-main" ${note.visibility === "published" ? `href="/article/${encodeURIComponent(note.slug)}"` : 'href="/admin"'} data-id="${escapeHtml(note.id)}">
        <div class="card-top"><span class="type-pill ${typeClass(note.type)}">${safeText(note.type)}</span><span class="card-date">${note.visibility === "published" ? "Terbit" : "Draf"} · ${formatDate(note.updatedAt)}</span></div>
        <h3>${safeText(note.title)}</h3>
        <p>${safeText(note.summary || "Belum ada ringkasan.")}</p>
        <div class="card-meta">${parent ? `<span>↳ ${safeText(parent.title)}</span><span class="meta-dot">·</span>` : ""}<span>${childCount} turunan</span></div>
      </a>
      ${note.imageUrl ? `<img class="note-thumbnail" src="${escapeHtml(note.imageUrl)}" alt="" loading="lazy">` : ""}
      <div class="card-admin-actions"><button class="button button-quiet" type="button" data-action="edit" data-id="${escapeHtml(note.id)}">Edit</button><button class="button button-quiet" type="button" data-action="delete" data-id="${escapeHtml(note.id)}">Hapus</button></div>
    </div>`;
  }

  function emptyMarkup(title, message) {
    return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">▤</div><h3>${title}</h3><p>${message}</p><a class="button button-primary" href="/admin">＋ Buat artikel pertama</a></div>`;
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
        <p>Wiki pribadi untuk menyimpan dunia, karakter, dan alur cerita yang saling terhubung. Cari judul, ikuti relasi, dan temukan kembali detail yang pernah kamu bayangkan.</p>
        <div class="hero-actions"><button class="button button-primary" type="button" data-action="add">＋ Tulis artikel baru</button><a class="hero-link" href="#/all">Jelajahi semua artikel <span aria-hidden="true">→</span></a></div>
      </section>
      <section class="stats-row" aria-label="Ringkasan perpustakaan">
        <div class="stat-card"><span class="stat-icon">▤</span><div><strong>${notes.length}</strong><span>artikel tersimpan</span></div></div>
        <div class="stat-card"><span class="stat-icon">◇</span><div><strong>${worlds}</strong><span>dunia cerita</span></div></div>
        <div class="stat-card"><span class="stat-icon">⌘</span><div><strong>${roots}</strong><span>artikel utama · ${characters} karakter</span></div></div>
      </section>
      <section>
        <div class="section-heading"><h2>Artikel terbaru</h2><a class="text-link" href="#/all">Lihat semua <span aria-hidden="true">→</span></a></div>
        ${recent.length ? `<div class="note-grid">${recent.map(cardMarkup).join("")}</div>` : emptyMarkup("Mulai dari satu ide", "Buat artikel pertamamu. Kamu bisa menghubungkannya dengan artikel lain nanti.")}
      </section>`;
  }

  function renderList(route) {
    const result = getFilteredNotes(route.filter);
    const query = searchInput.value.trim();
    const title = query ? `Hasil untuk “${escapeHtml(query)}”` : route.title;
    pageContent.innerHTML = `
      <div class="page-heading">
        <div><div class="eyebrow">LUCIMON LIBRARY · ARTIKEL</div><h1>${title}</h1><p>${query ? "Cari judul, isi, tag, dan artikel yang terhubung." : "Jelajahi gagasan berdasarkan hubungan dan jenisnya."}</p></div>
        <span class="result-count">${result.length} artikel</span>
      </div>
      ${result.length ? `<div class="note-grid">${result.map(cardMarkup).join("")}</div>` : emptyMarkup(query ? "Belum ada yang cocok" : "Bagian ini masih kosong", query ? "Coba kata lain atau periksa ejaan judul dan tag." : "Artikel yang kamu buat akan muncul di sini.")}`;
  }

  function renderNote(id) {
    const note = noteById(id);
    if (!note) {
      pageContent.innerHTML = `<div class="not-found">${emptyMarkup("Artikel tidak ditemukan", "Artikel ini mungkin sudah dihapus.")}<a class="back-link" href="#/all">← Kembali ke perpustakaan</a></div>`;
      return;
    }
    if (note.visibility === "published") location.replace(`/article/${encodeURIComponent(note.slug)}`);
    else pageContent.innerHTML = `<div class="empty-state"><h3>Artikel ini masih draf</h3><p>Artikel draf hanya dapat dibuka dari pengelola.</p><button class="button button-primary" type="button" data-action="edit" data-id="${escapeHtml(note.id)}">Edit artikel</button></div>`;
  }

  function renderAdmin() {
    const result = getFilteredNotes(() => true);
    pageContent.innerHTML = `
      <section class="home-hero">
        <div class="eyebrow">RUANG PENGELOLA</div>
        <h1>Kelola Lucimon Library.</h1>
        <p>Artikel draf hanya terlihat di sini. Artikel yang diterbitkan dapat dibaca siapa pun melalui tautan langsung.</p>
        <form id="profile-form" class="profile-form">
          <label class="field-label" for="profile-name">Nama profil</label>
          <div class="profile-row"><input class="text-field" id="profile-name" name="displayName" maxlength="60" required value="${safeText(profile.displayName)}"><button class="button button-quiet" type="submit">Simpan profil</button></div>
          <small class="field-hint">${safeText(profile.email)} · dilindungi Cloudflare Access</small>
        </form>
        <div class="hero-actions"><button class="button button-primary" type="button" data-action="add">＋ Tulis artikel baru</button><a class="hero-link" href="/cdn-cgi/access/logout?returnTo=${encodeURIComponent(location.origin + "/")}">Keluar</a></div>
      </section>
      <section>
        <div class="section-heading"><h2>Artikel saya</h2><span class="result-count">${result.length} artikel</span></div>
        ${result.length ? `<div class="note-grid">${result.map(adminCardMarkup).join("")}</div>` : emptyMarkup("Belum ada artikel", "Buat artikel pertama. Relasi parent dan artikel terkait boleh dikosongkan.")}
      </section>`;
    document.getElementById("profile-form").addEventListener("submit", saveProfile);
  }

  function render() {
    if (!isReady) return;
    const route = getRoute();
    document.getElementById("note-count").textContent = String(notes.length);
    document.getElementById("topbar-context").textContent = route.page === "admin" ? "RUANG PENGELOLA" : "PORTAL CERITA & GAGASAN";
    document.getElementById("admin-link").textContent = profile ? "Beranda" : "Masuk";
    document.getElementById("admin-link").href = profile ? "/" : "/admin";
    document.querySelector(".backup-menu").hidden = !profile;
    document.getElementById("add-button").textContent = profile ? "＋ Artikel baru" : "Masuk untuk menulis";
    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("active", (route.page === "home" && link.dataset.nav === "home") || (route.page === "list" && route.title === "Semua artikel" && link.dataset.nav === "all"));
    });
    if (route.page === "admin") renderAdmin();
    else if (route.page === "home") renderHome();
    else if (route.page === "note") renderNote(route.id);
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

  function openEditor(note) {
    form.reset();
    releasePreviewUrl();
    pendingImage = null;
    removeImage = false;
    imageUrl = note ? note.imageUrl : "";
    document.getElementById("field-id").value = note ? note.id : "";
    document.getElementById("dialog-title").textContent = note ? "Edit artikel" : "Artikel baru";
    document.getElementById("field-title").value = note ? note.title : "";
    document.getElementById("field-type").value = note ? note.type : "Catatan";
    document.getElementById("field-visibility").value = note ? note.visibility : "draft";
    document.getElementById("field-summary").value = note ? note.summary : "";
    contentEditor.innerHTML = note ? contentForEditor(note.content) : "";
    document.getElementById("field-tags").value = note ? note.tags.join(", ") : "";
    relatedSearch.value = "";
    selectedRelatedIds = new Set(note ? note.relatedIds : []);
    setImagePreview(imageUrl);

    const parentSelect = document.getElementById("field-parent");
    const available = notes.filter((item) => !note || item.id !== note.id);
    parentSelect.innerHTML = '<option value="">Tidak ada (artikel utama)</option>' +
      available.map((item) => `<option value="${escapeHtml(item.id)}">${safeText(item.title)}</option>`).join("");
    parentSelect.value = note ? note.parentId : "";
    renderRelatedOptions();
    dialog.showModal();
    document.getElementById("field-title").focus();
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
        relatedIds: Array.from(selectedRelatedIds).filter((relatedId) => relatedId !== oldId),
        tags: String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        imageKey: nextImageKey,
        imageUrl: nextImageUrl
      };
      const stored = await api(oldId ? `/api/admin/articles/${encodeURIComponent(oldId)}` : "/api/admin/articles", {
        method: oldId ? "PUT" : "POST",
        body: JSON.stringify(note)
      });
      const previousImageKey = oldNote ? oldNote.imageKey : "";
      notes = oldId ? notes.map((item) => item.id === oldId ? normalizeNote(stored) : item) : [normalizeNote(stored), ...notes];
      dialog.close();
      render();
      showToast(oldId ? "Artikel berhasil diperbarui." : "Artikel tersimpan di Lucimon Library.");
      if (previousImageKey && previousImageKey !== nextImageKey) {
        api(`/api/admin/images/${encodeURIComponent(previousImageKey)}`, { method: "DELETE" })
          .catch((error) => { console.error("Gambar lama tidak dapat dibersihkan:", error); showToast("Artikel tersimpan, tetapi gambar lama belum terhapus."); });
      }
    } catch (error) {
      console.error("Gagal menyimpan artikel:", error);
      if (uploadedImageKey) {
        api(`/api/admin/images/${encodeURIComponent(uploadedImageKey)}`, { method: "DELETE" })
          .catch((cleanupError) => console.error("Gambar unggahan sementara tidak dapat dibersihkan:", cleanupError));
      }
      showToast(error.message);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Simpan artikel";
    }
  }

  async function deleteNote(id) {
    const note = noteById(id);
    if (!note || !window.confirm(`Hapus “${note.title}”? Artikel turunannya akan menjadi artikel utama.`)) return;
    try {
      await api(`/api/admin/articles/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshNotes();
      render();
      showToast("Artikel dihapus.");
    } catch (error) {
      console.error("Gagal menghapus artikel:", error);
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
      showToast("Cadangan artikel diunduh. Gambar tetap tersimpan di Cloudflare R2.");
    } catch (error) {
      console.error("Gagal mengekspor cadangan:", error);
      showToast(error.message);
    }
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : (parsed.articles || parsed.notes);
      if (!Array.isArray(imported)) throw new Error("File harus berisi daftar artikel JSON.");
      const validated = imported.map(normalizeNote);
      if (!window.confirm(`Gabungkan ${validated.length} artikel dari cadangan ke ${notes.length} artikel yang ada? Artikel yang sudah ada tidak akan dihapus.`)) return;
      const result = await api("/api/admin/import", { method: "POST", body: JSON.stringify({ articles: validated }) });
      await refreshNotes();
      showToast(`${result.count} artikel diimpor sebagai draf.${result.skippedImages ? ` ${result.skippedImages} gambar tidak ikut dipindahkan.` : ""}`);
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
      if (profile) openEditor(null);
      else location.href = "/admin";
    }
    if (target.dataset.action === "edit" && profile) openEditor(noteById(target.dataset.id));
    if (target.dataset.action === "delete" && profile) deleteNote(target.dataset.id);
  });
  document.getElementById("add-button").addEventListener("click", () => {
    if (!isReady) return;
    if (profile) openEditor(null);
    else location.href = "/admin";
  });
  document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
  document.getElementById("cancel-dialog").addEventListener("click", () => dialog.close());
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
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      imageField.value = "";
      showToast("Pilih gambar JPEG, PNG, WebP, atau GIF berukuran maksimal 5 MB.");
      return;
    }
    releasePreviewUrl();
    pendingImage = file;
    removeImage = false;
    previewObjectUrl = URL.createObjectURL(file);
    setImagePreview(previewObjectUrl);
  });
  relatedOptions.addEventListener("change", () => {
    const visibleInputs = Array.from(relatedOptions.querySelectorAll('input[name="relatedIds"]'));
    const visibleIds = new Set(visibleInputs.map((input) => input.value));
    const checkedVisible = visibleInputs.filter((input) => input.checked).map((input) => input.value);
    selectedRelatedIds = new Set([
      ...Array.from(selectedRelatedIds).filter((id) => !visibleIds.has(id)),
      ...checkedVisible
    ]);
    document.getElementById("related-selected-count").textContent = selectedRelatedIds.size
      ? `${selectedRelatedIds.size} artikel dipilih.`
      : "Belum ada artikel yang dipilih.";
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
    else if (profile) render();
    else {
      const requestId = ++searchSequence;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(async () => {
        try {
          const query = encodeURIComponent(searchInput.value.trim());
          const result = await api(`/api/public/articles?q=${query}`);
          if (requestId === searchSequence) {
            notes = result.map(normalizeNote);
            render();
          }
        } catch (error) {
          console.error("Pencarian artikel gagal:", error);
          showToast(error.message);
        }
      }, 220);
    }
  });
  window.addEventListener("hashchange", render);
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
