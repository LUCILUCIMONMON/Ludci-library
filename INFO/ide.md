**WEBSITE PENAMPUNG IDE**

website ini saya ingin buat untuk menampung semua imajinasi saya, saya berisiniatip membuatnya karena saya suka buat cerita bersama AI agent, Ai memiliki batasan memori serta pemggunaan file word tidak efektif membuat saya kesulitan membuat cerita. website ini belum ada nama karena belum ku pikirkan.

A. KEAMANAN DAN PRIVASI.
web ini saya ingin buat tidak dapat diakses orang dengan cara tidak dapat ditemukan di mesin pencari kecuali saya kasih  link, soalnya website ini bersifat https pakai cloudflare.


B. FITUR FITUR.
saya mau buat ini terinpirasi dari justpaste juga, dimana saya bisa mengetik note didala, website ini dan bisa add lalu atur supaya privasi, ditemukan pakai link serta public.  saya pengen buat perpustkaan imajinasi, ya mirip mirip wikipedialah.

## Pembaruan prototipe — Lucimon Library

- Nama sementara website: **Lucimon Library**.
- Arah desain: navigasi utama berada di header; gaya wiki dengan palet biru.
- Artikel memiliki judul, jenis, ringkasan, isi, tag, relasi parent/child, tautan artikel terkait, dan gambar thumbnail.
- Relasi parent/child dan artikel terkait bersifat opsional. Tautan hubungan dapat dibuka langsung untuk berpindah antarartikel; cerita yang berdiri sendiri tetap didukung.
- Prototipe menyimpan artikel ke SQLite pada disk server dan gambar ke folder `data/uploads/`, bukan ke penyimpanan Chrome.
- Untuk menjalankan prototipe lokal, gunakan `npm start`; database berada di `data/lucimon-library.sqlite`.
- Data contoh hanya untuk memperlihatkan cara kerja wiki dan dapat dihapus.
- Gambar yang ditambahkan muncul sebagai thumbnail di daftar artikel dan sebagai gambar di halaman artikel.
- Prototipe lokal belum menjadi website publik. Agar bisa dibuka lewat tautan dan dibaca AI dari internet, aplikasi perlu di-deploy ke hosting dengan penyimpanan persisten. Akses tulis juga perlu diamankan sebelum server dibuka ke publik.

## Integrasi Cloudflare — implementasi awal

- Backend aplikasi disiapkan sebagai Cloudflare Worker. Artikel dan berkas gambar (BLOB, maksimal 1 MB per gambar) disimpan di D1 `lucimonlibrary`; aplikasi tidak memakai R2.
- Skema awal D1 berisi profil pemilik, artikel, hubungan artikel, dan metadata gambar. Migrasi lokal bisa dijalankan dengan `npm run db:apply:local`.
- Worker menyediakan halaman artikel langsung di `/article/<slug>` supaya setiap cerita dapat dibuka dan dibaca AI tanpa login. Halaman diberi `noindex`; ini meminta mesin pencari untuk tidak mengindeksnya, tetapi tidak membatasi orang yang memiliki tautan.
- Artikel baru berstatus **Draf**. Hanya artikel berstatus **Terbit** yang tersedia untuk umum. Pengelolaan, profil, impor/ekspor, dan penulisan dilindungi Cloudflare Access serta pemeriksaan identitas pemilik di Worker.
- Relasi parent dan artikel terkait tetap opsional. Jika relasi ada, tautannya membuka URL artikel secara langsung.
- Editor artikel mendukung paragraf, judul bagian, subjudul, tebal, miring, garis bawah, daftar, kutipan, tautan, dan garis pemisah. Isi HTML dibersihkan di Worker sebelum disimpan dan ditampilkan agar markup berbahaya tidak ikut diterbitkan.
- Bagian **Terhubung dengan** memakai kotak centang dan pencarian; beberapa artikel dapat dipilih sekaligus, dan pilihan tetap tersimpan saat daftar difilter. Kosongkan pilihan bila artikel berdiri sendiri.
- Untuk mencoba secara lokal, buka Terminal pada folder proyek, jalankan `npm start`, lalu buka `http://127.0.0.1:8787`. Tekan Ctrl+C di Terminal untuk menghentikannya. Perintah ini menjalankan Worker + aset web, dengan akun pengelola lokal `owner@example.test`; bukan login produksi.
- Jangan membuka `src/index.html` langsung atau menjalankan Live Server VS Code: aplikasi perlu Worker untuk API dan jalur asetnya menggunakan root situs, sehingga CSS dapat gagal dimuat di server yang melayani folder `src` sebagai subfolder. `LOCAL_DEV_AUTH` hanya dipasang oleh perintah `npm start` untuk alamat localhost, dan tidak pernah diaktifkan oleh perintah deploy.
- Prototipe SQLite sebelumnya dan folder `data/` tetap dipertahankan. Jalankan `npm run legacy` untuk membuka versi lama dan mengekspor cadangan artikelnya; impor lewat menu cadangan pada halaman pengelola baru. Hasil impor menjadi draf dan gambar dari cadangan lama tidak ikut berpindah otomatis, sehingga gambar perlu diunggah ulang.
- Migrasi skema awal sudah diterapkan ke D1 remote yang diberikan. Tabel dan indeks sudah ada, tetapi profil, artikel, dan gambar di database remote masih kosong.
- Migrasi `0002_store_images_in_d1.sql` menambahkan kolom BLOB untuk gambar ke D1. Terapkan dengan `npm run db:apply:remote` sebelum deployment pertama yang memakai migrasi ini.
- Worker belum di-deploy dan belum ada tautan publik. Data SQLite lokal tetap dipertahankan. Untuk impor cadangan lama, artikel akan masuk sebagai draf dan gambar lama perlu diunggah ulang.
- Sebelum deployment, atur dua aplikasi Cloudflare Access pada hostname Worker: `/admin*` dan `/api/admin*`, keduanya hanya mengizinkan email pemilik. Atur variabel Worker `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (AUD kedua aplikasi dipisahkan koma), dan `ADMIN_EMAIL`. Jangan pernah mengaktifkan `LOCAL_DEV_AUTH` di produksi.