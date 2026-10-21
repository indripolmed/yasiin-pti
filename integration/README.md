# Integrasi ke Website ysii.org

Website tetap berjalan seperti biasa. Integrasi hanya menambahkan **satu script** dan, opsionalnya, beberapa penanda kecil.
Form pendaftaran dan tombol WhatsApp yang sudah ada **tidak perlu diubah**.

## Langkah 1 — Pasang tracker (wajib)

**Jika website memakai WordPress (disarankan):**
1. Kompres folder `wordpress/ysii-tracker/` menjadi `ysii-tracker.zip`.
2. WordPress Admin → Plugin → Tambah Baru → Unggah Plugin → pilih zip → Aktifkan.
3. Buka **Pengaturan → YSII Tracker**, isi URL API (`https://api.ysii.org`), halaman kebijakan privasi, dan nomor WhatsApp admin.

Plugin tidak merekam admin/editor yang sedang login, agar data tidak tercampur.

**Jika bukan WordPress:** tempel baris ini di dalam `<head>` setiap halaman (atau lewat Google Tag Manager → Custom HTML):

```html
<script src="https://api.ysii.org/static/tracker.js" defer
        data-privacy-url="https://ysii.org/kebijakan-privasi"></script>
```

Setelah dipasang, pengunjung melihat banner persetujuan cookie. Data perilaku hanya direkam setelah pengunjung menekan **Setuju** (UU PDP).

## Langkah 2 — Pastikan form pendaftaran tersalin (otomatis)

Tracker menyalin isi form yang memiliki kolom nomor HP/WhatsApp atau email ke sistem lead **saat form dikirim**, lalu form tetap diproses oleh website seperti biasa.
Nama kolom dikenali otomatis untuk form HTML biasa, Contact Form 7, Elementor Forms, dan WPForms.

- Ingin hanya form tertentu yang disalin? Atur "Salin form" menjadi *Hanya form bertanda* lalu tambahkan atribut `data-ysii-form` pada tag `<form>`.
- Form pencarian, komentar, dan login otomatis diabaikan.
- Belum punya form? Lihat alternatif 7b di `contoh-halaman-program.html` (form langsung ke API).

**Cara cek:** isi form di website → buka dashboard → tab **Lead** → data muncul beserta skornya.

## Langkah 3 — Tombol WhatsApp (otomatis)

Semua tautan `wa.me` / `api.whatsapp.com` otomatis ditambahi `(Kode: XXXXXX)` di akhir pesan.
Saat chat masuk, admin membuka dashboard → **+ Lead dari WhatsApp** → isi nama, nomor, dan **kode** tersebut.
Lead akan terhubung dengan riwayat kunjungan pengunjung itu di website (halaman yang dibaca, sumber traffic, dan seterusnya).

> Jika tombol WhatsApp melayang dibuat oleh plugin yang membuka WA lewat JavaScript (bukan tautan `<a href>`),
> kodenya tidak bisa ditambahkan otomatis. Ganti dengan tautan `<a href="https://wa.me/62...">` biasa.

## Langkah 4 — Daftarkan program pelatihan (dashboard → tab Program)

Isi slug, nama, harga, URL, dan tanggal batch berikutnya. Slug harus sama dengan:
- bagian URL halaman program, misal `https://ysii.org/program/barista` → slug `barista`
  (pola yang dikenali: `/program/`, `/pelatihan/`, `/kursus/`, `/sertifikasi/`, `/training/`, `/kelas/`), **atau**
- custom field `ysii_program` di halaman WordPress, **atau** `<meta name="ysii:program" content="barista">`.

## Langkah 5 — Penanda opsional (meningkatkan kualitas data ML)

| Tambahkan | Agar tercatat sebagai |
|---|---|
| `id="harga"` / `id="biaya"` / `id="jadwal"` pada bagian harga | `view_price` (melihat biaya/jadwal) |
| Tautan ke file `.pdf` / berisi kata "brosur" | `download_brochure` |
| `data-track="click_cta"` pada tombol penting | `click_cta` |
| `<div id="ysii-reco"></div>` atau shortcode `[ysii_reco]` | Widget rekomendasi program & ajakan |

Contoh lengkap: [`contoh-halaman-program.html`](contoh-halaman-program.html).

## Langkah 6 — Kebijakan privasi

Buat halaman `/kebijakan-privasi` dari [`kebijakan-privasi-template.md`](kebijakan-privasi-template.md) (sesuaikan isinya).

## Pengecekan cepat setelah integrasi

1. Buka halaman program di mode penyamaran (incognito) → banner cookie muncul → klik **Setuju**.
2. Arahkan kursor ke tombol WhatsApp → tautannya berakhir dengan `(Kode: ...)`.
3. Di browser, buka DevTools → Console → ketik `ysii.visitorId`, hasilnya sebuah ID.
4. Isi form uji coba → lead muncul di dashboard dalam beberapa detik.
5. Jalankan PageSpeed Insights untuk memastikan skor tidak turun (tracker ±6 KB terkompresi, dimuat `defer`).
