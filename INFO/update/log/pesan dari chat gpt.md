PERBAIKAN AKSESIBILITAS KONTEN LUCIMON LIBRARY

Tujuan Utama

Perbaiki Lucimon Library agar isi artikel dapat dibaca oleh sistem eksternal, termasuk:

- ChatGPT dan AI lainnya.
- Mesin pencari seperti Google.
- Browser yang tidak menjalankan JavaScript secara penuh.
- Crawler dan sistem pengindeksan web.

Website saat ini menggunakan URL seperti:
https://ludci-library.ibraiking97windows.workers.dev/

Saya menemukan bahwa halaman dapat dibuka, tetapi isi artikel tidak terbaca oleh pembaca web tertentu. Kemungkinan konten dirender secara dinamis menggunakan JavaScript.

1. Analisis Struktur Website

Sebelum melakukan perubahan:

- Periksa seluruh struktur proyek.
- Identifikasi framework yang digunakan.
- Periksa sistem routing.
- Periksa cara artikel diambil dari database atau API.
- Identifikasi bagaimana halaman atribut, karakter, dunia, dan kategori lainnya menampilkan konten.
- Jangan langsung mengganti arsitektur aplikasi.

2. Buat API Publik untuk Artikel

Buat endpoint API publik yang memungkinkan sistem eksternal mengambil isi artikel.

Contoh rancangan endpoint:

"/api/attributes"
"/api/attributes/samudra-kosmoc-534ba317"
"/api/articles"
"/api/articles/{id}"

Sesuaikan dengan arsitektur dan sistem database yang sudah digunakan.

Respons API harus menggunakan JSON yang valid dan memuat:

- ID artikel.
- Judul.
- Slug.
- Kategori.
- Deskripsi.
- Isi lengkap artikel.
- Tanggal dibuat.
- Tanggal diperbarui.
- Relasi dengan artikel lainnya.
- Metadata yang tersedia.

Pastikan endpoint hanya memberikan data yang memang bersifat publik.

3. Buat Halaman yang Ramah Crawler

Jika memungkinkan, implementasikan SSR, prerendering, atau pendekatan rendering HTML yang sesuai dengan framework saat ini.

Ketika seseorang membuka URL artikel, HTML yang diterima harus memiliki:

- Judul artikel.
- Deskripsi artikel.
- Isi artikel.
- Metadata.
- Canonical URL.

Jangan hanya mengirim HTML kosong yang menunggu JavaScript untuk mengambil seluruh konten.

Jika menggunakan Cloudflare Workers, sesuaikan implementasinya dengan kemampuan deployment yang tersedia.

4. Perbaiki Sistem Routing

Saat ini URL menggunakan fragment "#/attribute/...".

Evaluasi kemungkinan migrasi ke URL berbasis path:

"/attribute/samudra-kosmoc-534ba317"

Pertahankan kompatibilitas dengan URL lama agar tautan yang sudah dibagikan tidak rusak. Jika migrasi belum memungkinkan, sediakan alternatif endpoint publik yang tetap bisa digunakan.

5. Dukungan Relasi Artikel

Pastikan API dapat memberikan informasi hubungan antarartikel.

Contoh:

- Samudra Kosmoc berhubungan dengan Kosmologi Digital.
- Kosmologi Digital berhubungan dengan konsep dunia tertentu.
- Artikel dapat memiliki relasi dengan atribut lain.

Jangan membuat relasi fiktif. Ambil hanya relasi yang benar-benar tersimpan di database.

6. SEO dan Pengindeksan

Tambahkan:

- sitemap.xml.
- robots.txt.
- Metadata Open Graph.
- JSON-LD jika sesuai.
- Judul dan deskripsi unik untuk setiap artikel.

Jangan mengindeks halaman privat atau data internal.

7. Pengujian Wajib

Setelah implementasi, lakukan pengujian:

1. Buka URL artikel secara langsung tanpa navigasi dari halaman utama.
2. Ambil HTML menggunakan HTTP GET tanpa menjalankan JavaScript.
3. Pastikan judul dan isi artikel muncul di HTML jika menggunakan SSR atau prerendering.
4. Uji endpoint API dan pastikan JSON berisi isi artikel lengkap.
5. Uji relasi artikel.
6. Pastikan aplikasi tetap berjalan normal.
7. Pastikan artikel lama tidak hilang dan tautan lama tetap berfungsi.

8. Batasan Perubahan

- Jangan menghapus artikel.
- Jangan mengubah isi lore.
- Jangan mengubah desain UI tanpa alasan teknis.
- Jangan menghapus fitur relasi.
- Jangan mengganti database tanpa kebutuhan.
- Jangan membuat data contoh sebagai pengganti data asli.
- Pertahankan sistem autentikasi dan keamanan yang sudah ada.
- Jangan mengekspos kredensial, token, atau data privat.

HASIL YANG DIHARAPKAN

Saya ingin ketika ChatGPT atau crawler membuka URL artikel Lucimon Library, sistem dapat memperoleh isi artikel yang sebenarnya, bukan hanya kerangka halaman.

Prioritaskan solusi yang kompatibel dengan arsitektur proyek saat ini.

Sebelum mengubah kode, jelaskan terlebih dahulu penyebab masalah berdasarkan hasil pemeriksaan proyek. Setelah itu implementasikan perbaikan dan berikan laporan file apa saja yang diubah beserta hasil pengujiannya.