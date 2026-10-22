# Berkas Pendaftaran HKI — Program Komputer

| Berkas | Keterangan |
|---|---|
| `Manual-Book-Sistem-Promosi-Digital-SEO-ML-v1.0.pdf` | Manual book (contoh ciptaan) untuk diunggah ke e-hakcipta DJKI |
| `Manual-Book-Sistem-Promosi-Digital-SEO-ML-v1.0.docx` | Versi Word yang dapat diedit |
| `Deskripsi-Program-Komputer.pdf` / `.docx` | Data ciptaan, **uraian singkat untuk formulir DJKI**, fungsi, keunggulan, spesifikasi teknis, daftar berkas kode |
| `Kode-Sumber-Halaman-Awal-dan-Akhir.pdf` | Contoh ciptaan berupa kode sumber: sampul + 10 halaman awal + 10 halaman akhir |
| `Kode-Sumber-Lengkap.pdf` | Listing kode sumber lengkap bernomor baris (56 halaman), sebagai arsip / bila diminta |
| `sumber/` | Skrip untuk membuat ulang manual (screenshot, diagram, dokumen) |

Dokumen lain dibuat ulang dengan skrip di `docs/sumber-dokumen/` (mis. `node build_kode_sumber.js <repo> <output> 10` bila kode berubah; ubah angka 10 jika sentra HKI meminta jumlah halaman lain).

## Periksa sebelum mengunggah

- [ ] **Daftar pencipta** pada halaman *Identitas Program Komputer* sudah sesuai dengan formulir HKI (urutan, gelar, dan apakah mahasiswa ikut dicantumkan sebagai pencipta).
- [ ] **Pemegang hak cipta** (Politeknik Negeri Medan) sudah sesuai dengan ketentuan sentra HKI kampus.
- [ ] Tanggal dan tempat *pertama kali diumumkan* diisi pada formulir DJKI.
- [ ] Setelah diedit di Word, perbarui daftar isi (klik kanan pada daftar isi → *Update Field* → *Update entire table*), lalu simpan ulang sebagai PDF.

Semua screenshot memakai **data simulasi** (nama "Calon Peserta …", "Rina Pratiwi", dan "Budi Santoso" bukan orang nyata).

## Kelengkapan lain yang biasanya diminta DJKI

1. Formulir permohonan dan surat pernyataan kepemilikan ciptaan bermeterai
2. Surat pengalihan hak dari pencipta kepada Politeknik Negeri Medan
3. KTP seluruh pencipta
4. Contoh ciptaan: **manual book** dan **potongan kode sumber** (halaman awal dan akhir) — keduanya sudah tersedia di folder ini
5. Bukti pembayaran PNBP

## Membuat ulang manual

Perlu Node.js (paket `docx` & `playwright`), Python, dan LibreOffice.

1. Jalankan aplikasi dengan data simulasi (lihat README utama), lalu sajikan `halaman_contoh_screenshot.html` di `http://localhost:8080/program/barista.html`.
2. `node sumber/ambil_screenshot.js <folder>/shots`
3. `node sumber/diagram/render.js sumber/diagram` (salin `arsitektur.png` & `alur.png` ke `<folder>/diag`)
4. `node sumber/build_manual.js <folder> manual.docx`
5. `python3 sumber/update_toc.py manual.docx manual-final.docx manual-final.pdf` (mengisi daftar isi & ekspor PDF)
