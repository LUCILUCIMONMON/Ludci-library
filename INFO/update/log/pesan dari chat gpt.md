Saya ingin meningkatkan kompatibilitas AI dan mesin pencari untuk SELURUH Lucimon Library, bukan hanya satu artikel.

TUJUAN UTAMA:
Setiap artikel yang sudah ada maupun yang akan dibuat di masa depan harus otomatis dapat dibaca oleh AI eksternal seperti ChatGPT, crawler, dan mesin pencari tanpa membutuhkan login.

CAKUPAN WAJIB:
Berlaku untuk semua jenis konten:
- Attribute
- Story
- Character
- World
- Timeline
- Location
- Lore
- Category
- Jenis konten lainnya yang tersedia dalam sistem.

PERSYARATAN TEKNIS:

1. Sistem universal
   - Jangan membuat solusi khusus berdasarkan ID atau slug artikel.
   - Semua artikel harus menggunakan mekanisme rendering dan publikasi yang sama.
   - Artikel baru otomatis mengikuti sistem ini tanpa konfigurasi manual.

2. Rendering konten
   - Pastikan konten artikel publik tersedia dalam HTML yang dapat dibaca crawler.
   - Jangan hanya mengandalkan JavaScript SPA untuk menampilkan isi artikel.
   - Implementasikan SSR, prerendering, atau pendekatan lain yang cocok dengan arsitektur saat ini.

3. URL dan routing
   - Evaluasi kelemahan routing berbasis hash (#/).
   - Pertimbangkan URL permanen berbasis path untuk setiap artikel.
   - Pastikan URL lama tetap berfungsi melalui redirect atau kompatibilitas routing.

4. API publik
   - Sediakan mekanisme pengambilan data artikel publik secara terstruktur.
   - Berlaku untuk semua jenis artikel.
   - Jangan memerlukan autentikasi untuk konten yang memang berstatus publik.
   - Jangan pernah mengekspos artikel privat, token, atau data internal.

5. SEO otomatis
   - Setiap artikel otomatis memiliki:
     - Title
     - Meta description
     - Canonical URL
     - Open Graph metadata
     - Structured data yang sesuai jika relevan.
   - Metadata dibuat berdasarkan data artikel, bukan ditulis manual satu per satu.

6. Artikel masa depan
   - Ketika pengguna membuat artikel baru, sistem langsung menerapkan seluruh mekanisme di atas.
   - Ketika artikel diperbarui, hasil rendering dan metadata ikut diperbarui.
   - Ketika artikel dihapus atau dijadikan privat, akses publik harus mengikuti status terbarunya.

7. Keamanan
   - Hanya konten berstatus publik yang boleh dibaca secara eksternal.
   - Jangan mengekspos environment variables, secrets, database internal, atau informasi pengguna.
   - Jangan mengubah izin akses artikel privat.

8. Kompatibilitas
   - Pertahankan Cloudflare Workers.
   - Jangan merusak editor, database, relasi antarartikel, sistem pencarian, maupun fitur Lucimon Library lainnya.

TAHAP PENGERJAAN:

A. Audit arsitektur yang sudah ada.
B. Jelaskan penyebab artikel tidak terbaca crawler.
C. Rancang solusi universal.
D. Implementasikan tanpa membangun ulang aplikasi.
E. Uji beberapa jenis artikel yang berbeda.
F. Buat satu artikel baru sebagai pengujian otomatisasi.
G. Uji menggunakan HTTP request tanpa JavaScript.

KRITERIA KEBERHASILAN:

- Semua artikel publik dapat dibaca melalui HTTP.
- Artikel baru otomatis dapat dibaca tanpa konfigurasi tambahan.
- Artikel privat tetap terlindungi.
- Perubahan artikel langsung tercermin pada hasil publik.
- Tidak ada solusi hardcode untuk satu artikel.

Jangan menganggap pekerjaan selesai hanya karena halaman utama berhasil diindeks. Uji isi artikel sebenarnya.