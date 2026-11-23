**WEBSITE PENAMPUNG IDE**

website ini saya ingin buat untuk menampung semua imajinasi saya, saya berisiniatip membuatnya karena saya suka buat cerita bersama AI agent, Ai memiliki batasan memori serta pemggunaan file word tidak efektif membuat saya kesulitan membuat cerita. website ini belum ada nama karena belum ku pikirkan.

A. KEAMANAN DAN PRIVASI.
web ini saya ingin buat tidak dapat diakses orang dengan cara tidak dapat ditemukan di mesin pencari kecuali saya kasih  link, soalnya website ini bersifat https pakai cloudflare.


B. FITUR FITUR.
saya mau buat ini terinpirasi dari justpaste juga, dimana saya bisa mengetik note didala, website ini dan bisa add lalu atur supaya privasi, ditemukan pakai link serta public.  saya pengen buat perpustkaan imajinasi, ya mirip mirip wikipedialah.

## Pembaruan prototipe — Lucimon Library

- Nama sementara website: **Lucimon Library**.
- Arah desain: navigasi utama berada di header; gaya wiki dengan palet biru.
- Cerita memiliki judul, jenis, ringkasan, isi, tag, relasi parent/child opsional, relasi cerita berlabel, atribut, dan gambar thumbnail.
- Relasi cerita menghubungkan satu cerita ke cerita lain. Atribut adalah artikel mandiri non-cerita (misalnya profil tokoh, dunia, konsep, atau tempat) dengan jenis, judul, dan deskripsi; atribut dapat diterbitkan tanpa cerita dan ditautkan ke beberapa cerita.
- Playlist publik mengelompokkan cerita terbit dalam urutan yang dapat diatur; pengguna yang masuk dapat membuat dan mengubah playlist miliknya.
- Prototipe menyimpan artikel ke SQLite pada disk server dan gambar ke folder `data/uploads/`, bukan ke penyimpanan Chrome.
- Untuk menjalankan prototipe lokal, gunakan `npm start`; database berada di `data/lucimon-library.sqlite`.
- Data contoh hanya untuk memperlihatkan cara kerja wiki dan dapat dihapus.
- Gambar yang ditambahkan muncul sebagai thumbnail di daftar artikel dan sebagai gambar di halaman artikel.
- Prototipe lokal belum menjadi website publik. Agar bisa dibuka lewat tautan dan dibaca AI dari internet, aplikasi perlu di-deploy ke hosting dengan penyimpanan persisten. Akses tulis juga perlu diamankan sebelum server dibuka ke publik.

## Integrasi Cloudflare — implementasi awal

- Backend aplikasi disiapkan sebagai Cloudflare Worker. Cerita dan berkas gambar (BLOB, maksimal 1 MB per gambar) disimpan di D1 `lucimonlibrary`; aplikasi tidak memakai R2.
- Skema awal D1 berisi profil pemilik, cerita, hubungan cerita, dan metadata gambar. Migrasi lokal bisa dijalankan dengan `npm run db:apply:local`.
- Worker menyediakan halaman cerita langsung di `/article/<slug>` supaya setiap cerita dapat dibuka dan dibaca AI tanpa login. Halaman diberi `noindex`; ini meminta mesin pencari untuk tidak mengindeksnya, tetapi tidak membatasi orang yang memiliki tautan.
- Halaman Panduan tersedia di `/guide`. Worker menyajikan isi panduan sebagai HTML lengkap agar dapat dibaca langsung tanpa menjalankan JavaScript; konten sumbernya ada di `src/guide-content.html`.
- Pengguna membuat akun editor dengan email dan kata sandi sebelum mengirim konten. Pendaftaran terbuka; akun baru langsung menjadi editor. Editor dapat menerbitkan cerita, artikel atribut, dan playlist, serta hanya dapat mengubah atau menghapus miliknya. Pengguna yang masuk dapat mengunggah gambar maksimal 1 MB. Pemilik situs dapat mengelola semua konten; ekspor/impor hanya untuk pemilik.
- Cerita, atribut, dan playlist memiliki pemilik akun. Editor hanya dapat mengubah atau menghapus konten miliknya; pemilik situs dapat mengelola semua konten. Penghapusan artikel bersifat permanen; buat ekspor JSON terlebih dahulu bila ingin menyimpan cadangan.
- Relasi parent/child tetap opsional. Relasi berlabel dapat menghubungkan satu cerita ke banyak cerita lain dan tautannya membuka halaman cerita tujuan.
- Kategori cerita dapat dipilih lebih dari satu: Canon, Alternative, Retelling, Sidequel, Spin-off, Reboot, Restart, dan What if. Jenis entri (Dunia, Karakter, Alur, Tempat, Catatan) tetap menjadi klasifikasi terpisah.
- Setiap cerita dapat ditautkan secara opsional ke satu cerita utama; tautan ini terpisah dari parent/child dan relasi berlabel. Cerita utama juga menampilkan cerita-cerita yang menjadikannya acuan.
- Penanda **Cerita tersembunyi · lore rahasia** menjelaskan peran naratif rahasia, bukan menyembunyikan cerita atau tautannya. Penanda tetap terlihat pada kartu dan halaman cerita.
- Siapa pun dapat membuat dan menerbitkan artikel atribut mandiri tanpa login. Pengelola dapat menyunting artikel atribut dan mengatur status draf/terbit. Daftar atribut publik memuat entri terbit meski belum tertaut ke cerita; halaman atribut juga menampilkan cerita-cerita yang ditautkan.
- Pengelola dapat menghapus artikel atribut; tautan atribut dari cerita ikut dilepas, tetapi cerita tidak ikut terhapus. Impor cadangan memperbarui artikel/atribut dengan ID yang sama, mempertahankan status dan relasi dari JSON, menambahkan entri baru, serta tidak menghapus data yang tidak ada dalam cadangan.
- Editor cerita dapat mencari dan menautkan atribut terbit yang sudah ada, atau membuat atribut baru bersamaan dengan cerita. Entri atribut bukan cerita; cerita lain tetap dihubungkan lewat Relasi.
- Editor cerita mendukung paragraf, judul bagian, subjudul, tebal, miring, garis bawah, daftar, kutipan, tautan, dan garis pemisah. Isi HTML dibersihkan di Worker sebelum disimpan dan ditampilkan agar markup berbahaya tidak ikut diterbitkan.
- Bagian **Hubungan dengan cerita lain** memakai kotak centang dan pencarian; beberapa relasi berlabel dapat dipilih sekaligus, dan pilihan tetap tersimpan saat daftar difilter. Bagian **Artikel atribut yang ditautkan ke cerita** dapat mencari atribut terbit atau membuat atribut baru yang ditautkan ke cerita itu.
- Playlist publik dapat dibuat dan diubah tanpa login, memiliki urutan cerita yang dapat disusun, dan hanya menerima cerita yang sudah diterbitkan.
- Untuk mencoba secara lokal, buka Terminal pada folder proyek, jalankan `npm start`, lalu buka `http://127.0.0.1:8787`. Tekan Ctrl+C di Terminal untuk menghentikannya. Perintah ini menjalankan Worker + aset web, dengan akun pengelola lokal `owner@example.test`; bukan login produksi.
- Jangan membuka `src/index.html` langsung atau menjalankan Live Server VS Code: aplikasi perlu Worker untuk API dan jalur asetnya menggunakan root situs, sehingga CSS dapat gagal dimuat di server yang melayani folder `src` sebagai subfolder. `LOCAL_DEV_AUTH` hanya dipasang oleh perintah `npm start` untuk alamat localhost, dan tidak pernah diaktifkan oleh perintah deploy.
- Prototipe SQLite sebelumnya dan folder `data/` tetap dipertahankan. Jalankan `npm run legacy` untuk membuka versi lama dan mengekspor cadangan artikelnya; impor lewat menu cadangan pada halaman pengelola baru. Hasil impor cerita dan atribut menjadi draf; gambar dari cadangan lama tidak ikut berpindah otomatis sehingga perlu diunggah ulang.
- Migrasi skema awal sudah diterapkan ke D1 remote yang diberikan. Tabel dan indeks sudah ada, tetapi profil, artikel, dan gambar di database remote masih kosong.
- Migrasi `0002_store_images_in_d1.sql` menambahkan kolom BLOB untuk gambar ke D1. Terapkan dengan `npm run db:apply:remote` sebelum deployment pertama yang memakai migrasi ini.
- Migrasi `0003_public_submission_limits.sql` adalah migrasi historis; Worker tidak lagi memakai batas jumlah kiriman artikel publik.
- Migrasi `0004_story_graph_and_playlists.sql` menambahkan label relasi, atribut cerita, dan penyimpanan playlist serta urutan ceritanya. Terapkan dengan `npm run db:apply:remote` sebelum deployment Worker yang memuat fitur ini.
- Migrasi `0005_story_categories_and_main_story.sql` menambahkan kategori cerita majemuk, penanda lore rahasia, dan tautan opsional ke cerita utama. Cerita lama otomatis memakai kategori Canon. Terapkan dengan `npm run db:apply:remote` sebelum deployment Worker yang memuat fitur ini.
- Migrasi `0006_reusable_story_attributes.sql` menambahkan entri atribut berdeskripsi yang dapat dipakai ulang oleh banyak cerita dan memindahkan pasangan atribut lama ke bentuk entri. Terapkan dengan `npm run db:apply:remote` sebelum deployment Worker yang memuat fitur ini.
- Migrasi `0007_publishable_attribute_entries.sql` menambahkan status draf/terbit untuk artikel atribut; atribut lama yang terhubung ke cerita terbit otomatis tetap terbit. Terapkan dengan `npm run db:apply:remote` sebelum deployment Worker yang memuat fitur ini.
- Worker sudah di-deploy pada alamat `workers.dev`. Data SQLite lokal tetap dipertahankan. Untuk impor cadangan lama, artikel akan masuk sebagai draf dan gambar lama perlu diunggah ulang.
- Email pemilik produksi ditetapkan sebagai `ADMIN_EMAIL` di `wrangler.jsonc`. Buat kata sandi baru yang belum pernah dibagikan dan simpan sebagai secret dengan `npx wrangler secret put ADMIN_PASSWORD`; masukkan kata sandi hanya pada prompt terminal (minimal 12 karakter). Setelah Wrangler terhubung ke akun Cloudflare pemilik, jalankan `npm run db:apply:remote`, lalu `npm run deploy`. Terapkan migrasi 0008–0010 sebelum memakai login dan kepemilikan konten. Pendaftaran publik terbuka dan akun baru langsung menjadi editor; hanya pemilik yang dapat mengimpor/mengekspor cadangan. Jangan pernah mengaktifkan `LOCAL_DEV_AUTH` di produksi.