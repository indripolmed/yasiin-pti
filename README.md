# YSII — Sistem Promosi Digital Terintegrasi SEO & Machine Learning

Prototipe sistem untuk penelitian **"Sistem Promosi Digital Terintegrasi Berbasis SEO dan Machine Learning untuk Prediksi Perilaku Calon Peserta Pelatihan"** (PTI 2026, Politeknik Negeri Medan × Yayasan Sinergi Inspirasi Indonesia).

Sistem ini **dipasang di samping website https://ysii.org yang sudah ada**. Website tidak dibangun ulang. Integrasinya cukup satu script, dan form pendaftaran serta tombol WhatsApp yang sudah ada tetap dipakai.

```
 Website ysii.org (yang sudah ada)                 Server sistem (api.ysii.org)
 ┌───────────────────────────────┐   perilaku    ┌──────────────────────────────────┐
 │ tracker.js (1 baris script)   │ ────────────▶ │ FastAPI ── PostgreSQL            │
 │  • banner persetujuan cookie  │               │  • /v1/collect   tracking        │
 │  • kode referensi WhatsApp    │   form lead   │  • /v1/leads     pendaftaran     │
 │  • salin form pendaftaran     │ ────────────▶ │  • /v1/recommend rekomendasi     │
 │  • widget rekomendasi         │ ◀──────────── │  • ML engine (RF / GB / LR)      │
 └───────────────────────────────┘               │  • Dashboard admin  /dashboard   │
 Google Search Console ──── ETL harian ────────▶ │  • Scheduler (ETL & retrain)     │
                                                  └──────────────────────────────────┘
```

| Modul (proposal) | Implementasi |
|---|---|
| 1. SEO engine | ETL Google Search Console (`jobs/gsc_etl.py`), tab **SEO** di dashboard (kata kunci, halaman, CTR rendah), contoh schema markup `Course` di `integration/` |
| 2. User behavior tracking | `backend/app/static/tracker.js` + `POST /v1/collect`: halaman, waktu aktif, scroll 25–100%, klik WA/CTA, lihat harga, unduh brosur, mulai/kirim form, pencarian situs, sumber traffic & UTM |
| 3. ML predictive engine | `app/ml_engine.py`: CRISP-DM, perbandingan **Logistic Regression (baseline), Random Forest, Gradient Boosting**, stratified k-fold CV, data uji 20%, F1/AUC/confusion matrix, permutation importance |
| 4. Dashboard manajemen lead | `/dashboard`: KPI, lead diurutkan menurut skor (Hot/Warm/Cold), perjalanan pengunjung, update status follow-up, ekspor CSV |
| 5. Pendaftaran terintegrasi | Form website lama disalin otomatis ke `POST /v1/leads`; chat WhatsApp terhubung lewat kode referensi |
| 6. Rekomendasi konten dinamis | `GET /v1/recommend`: program yang sering dilihat bersama + ajakan (CTA) sesuai segmen pengunjung |

### Dua model prediksi

| Model | Pertanyaan | Dipakai untuk |
|---|---|---|
| `lead` | Seberapa besar peluang **lead ini menjadi peserta**? | Mengurutkan lead di dashboard agar tim menghubungi yang paling serius dulu |
| `visitor` | Seberapa besar peluang **pengunjung ini menjadi lead**? | Memilih rekomendasi & ajakan yang tampil di website |

Selama data latih belum cukup (default: minimal 30 contoh positif dan 30 negatif), sistem memakai **skor berbasis aturan** yang transparan. Begitu tim mengisi status lead (terdaftar/bayar/batal) di dashboard, data itu menjadi label baru, dan model dilatih ulang otomatis setiap Senin pukul 02.00 WIB (*closed-loop learning*).

Fitur ML selalu dihitung **sampai saat pengunjung mendaftar**, sehingga perilaku sesudah mendaftar tidak ikut dipakai dan label tidak bocor ke model. Untuk model `visitor`, klik WhatsApp dan mulai mengisi form juga dikeluarkan dari fitur, karena keduanya adalah aksi menjadi lead itu sendiri.

### Tampilan

| Daftar lead (urut skor) | Detail lead & perjalanan pengunjung |
|---|---|
| ![Daftar lead](docs/screenshots/dashboard-lead.png) | ![Detail lead](docs/screenshots/dashboard-detail-lead.png) |

| Perbandingan algoritma | Widget rekomendasi di website |
|---|---|
| ![Model ML](docs/screenshots/dashboard-model.png) | ![Widget](docs/screenshots/website-widget-rekomendasi.png) |

*Screenshot memakai data simulasi.*

---

## Isi repositori

```
backend/
  app/
    main.py            aplikasi FastAPI
    models.py          skema database (ERD)
    features.py        feature engineering perilaku
    ml_engine.py       pelatihan & perbandingan 3 algoritma
    scoring.py         skor ML / aturan + segmentasi
    recommend.py       rekomendasi konten
    routers/public.py  endpoint untuk website (collect, leads, recommend)
    routers/admin.py   endpoint dashboard (login wajib)
    static/tracker.js  script yang dipasang di website
    static/dashboard/  dashboard admin
  ml/train.py          CLI pelatihan model
  jobs/                ETL Search Console & penjadwal
  scripts/             buat admin, data simulasi
  tests/               tes otomatis (pytest)
integration/           plugin WordPress, contoh halaman, templat kebijakan privasi
nginx/                 reverse proxy + HTTPS
docs/                  panduan langkah pembangunan sistem
docker-compose.yml
```

---

## Mencoba di komputer sendiri (tanpa Docker)

Butuh Python 3.12+.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

python -m scripts.create_admin admin                   # buat akun dashboard
python -m scripts.generate_synthetic --visitors 3000   # data SIMULASI untuk demo
python -m ml.train                                     # latih & bandingkan model
uvicorn app.main:app --reload
```

Buka:
- Dashboard: http://localhost:8000/dashboard/
- Dokumentasi API (Swagger): http://localhost:8000/docs

Database default adalah SQLite (`backend/ysii.db`). Untuk PostgreSQL, set `DATABASE_URL`.

> ⚠️ **Data simulasi hanya untuk demo dan pengujian.** Angka akurasinya **bukan** hasil penelitian.
> Untuk laporan dan jurnal, gunakan data nyata dari website mitra.

**Menjalankan tes:**

```bash
cd backend && pytest -q
# terhadap PostgreSQL:
TEST_DATABASE_URL=postgresql+psycopg://user:pass@host:5432/ysii_test pytest -q
```

---

## Deployment ke server (VPS)

Kebutuhan: VPS Ubuntu (2 vCPU, 4 GB RAM sudah cukup), Docker, dan akses DNS domain ysii.org.

1. **DNS**: buat record `A` untuk `api.ysii.org` yang mengarah ke IP VPS.
2. **Ambil kode & konfigurasi**
   ```bash
   git clone https://github.com/indripolmed/yasiin-pti.git && cd yasiin-pti
   cp .env.example .env
   nano .env        # isi DB_PASSWORD, SECRET_KEY (openssl rand -hex 32), WHATSAPP_ADMIN, dll.
   ```
3. **Jalankan**
   ```bash
   docker compose up -d --build
   docker compose exec api python -m scripts.create_admin admin
   curl http://api.ysii.org/v1/health
   ```
4. **Aktifkan HTTPS** (wajib sebelum dipasang di website)
   ```bash
   docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
     -d api.ysii.org --email admin@ysii.org --agree-tos --no-eff-email
   cp nginx/https.conf.example nginx/templates/https.inc.template
   docker compose restart nginx
   ```
   Perpanjangan otomatis (crontab VPS, setiap bulan):
   ```
   0 3 1 * * cd /root/yasiin-pti && docker compose run --rm certbot renew && docker compose restart nginx
   ```
5. **Pasang ke website ysii.org**: ikuti [`integration/README.md`](integration/README.md).
6. **Isi program pelatihan** di dashboard (`https://api.ysii.org/dashboard/` → tab Program).
7. **Backup harian** (crontab VPS):
   ```
   30 1 * * * cd /root/yasiin-pti && docker compose exec -T db pg_dump -U ysii ysii | gzip > /root/backup/ysii-$(date +\%F).sql.gz
   ```

Update versi: `git pull && docker compose up -d --build`.

### Google Search Console (modul SEO)

1. Google Cloud Console: buat project, aktifkan **Google Search Console API**, buat *service account*, lalu unduh kunci JSON ke `secrets/gsc-sa.json`.
2. Search Console → Setelan → Pengguna dan izin → tambahkan email service account (izin *Terbatas*).
3. Di `.env`: `GSC_CREDENTIALS_FILE=/secrets/gsc-sa.json` dan `GSC_SITE_URL=sc-domain:ysii.org`, lalu `docker compose up -d`.
4. Ambil data awal (GSC menyimpan ±16 bulan), yang sekaligus menjadi baseline *pre-test*:
   `docker compose exec api python -m jobs.gsc_etl --days 480`

Setelah itu data diperbarui otomatis setiap hari pukul 06.00 WIB.

### Notifikasi lead HOT (opsional)

Isi `HOT_LEAD_WEBHOOK_URL` dengan URL webhook (misalnya n8n, Make, Slack, atau layanan gateway WhatsApp). Setiap lead dengan segmen *hot* dikirim sebagai JSON berisi `text`, `name`, `phone`, `program`, dan `score`.

---

## Pemakaian harian (admin mitra)

1. **Tab Lead** menampilkan lead yang masih berjalan, diurutkan dari skor tertinggi. Hubungi yang **Hot** lebih dulu (tombol WhatsApp).
2. Klik sebuah lead untuk melihat halaman yang dibaca, sumber kunjungan, dan alasan skornya.
3. **Perbarui status** setiap lead: dihubungi → tertarik → terdaftar/bayar, atau batal. Status ini adalah bahan belajar model.
4. Chat WhatsApp yang berisi `(Kode: XXXXXX)` → **+ Lead dari WhatsApp**, lalu isi kodenya.
5. **Tab Model ML** menampilkan perbandingan algoritma. Model dapat dilatih ulang dengan tombol "Latih ulang" kapan saja.

## Untuk penelitian (laporan, jurnal, HKI)

- **Dataset fitur** untuk analisis di notebook:
  `docker compose exec api python -m ml.train --task lead --export-dataset /app/models/lead.csv`
- **Laporan setiap pelatihan** (metrik CV & data uji, confusion matrix, feature importance) tersimpan sebagai JSON di volume `models` dan tampil di tab Model ML.
- **Pre/post test SEO**: data GSC harian di tabel `gsc_daily`, KPI konversi di tab Ringkasan.
- **Akurasi pada data operasional**: skor asli lead yang sudah selesai tidak diubah saat model dilatih ulang, sehingga ketepatan prediksi bisa dievaluasi (segmen vs status akhir).
- Catatan metodologi: pada data yang tidak seimbang, **akurasi bisa menyesatkan**. Laporkan F1, recall, dan AUC sebagai metrik utama.

## Keamanan & privasi

- Tracking hanya berjalan setelah pengunjung menyetujui banner cookie (UU PDP No. 27/2022). Templat kebijakan privasi ada di `integration/`.
- Pengunjung diidentifikasi dengan ID acak di browser, bukan nama atau IP. IP tidak disimpan.
- Dashboard memerlukan login. Password disimpan dengan PBKDF2, dan sesi memakai token JWT 12 jam.
- CORS dibatasi ke domain di `ALLOWED_ORIGINS`. Ada rate limit per IP, honeypot anti-spam pada form, dan redirect form hanya ke domain yang diizinkan.

Panduan langkah-langkah lengkap: [`docs/LANGKAH-PEMBANGUNAN-SISTEM.md`](docs/LANGKAH-PEMBANGUNAN-SISTEM.md).
