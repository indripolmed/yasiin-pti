// Urutan berkas kode sumber untuk dokumen HKI (dari titik masuk aplikasi hingga konfigurasi deployment).
// Kode pengujian, data simulasi, dan pustaka pihak ketiga (Chart.js) tidak termasuk.
const SOURCE_FILES = [
  ['backend/app/main.py', 'Titik masuk aplikasi FastAPI'],
  ['backend/app/config.py', 'Konfigurasi aplikasi'],
  ['backend/app/db.py', 'Koneksi basis data'],
  ['backend/app/models.py', 'Skema basis data (ORM)'],
  ['backend/app/security.py', 'Hash password & token login'],
  ['backend/app/traffic.py', 'Klasifikasi sumber traffic & intent'],
  ['backend/app/features.py', 'Feature engineering perilaku'],
  ['backend/app/ml_engine.py', 'Pelatihan & perbandingan algoritma ML'],
  ['backend/app/scoring.py', 'Skor konversi & segmentasi'],
  ['backend/app/recommend.py', 'Rekomendasi konten'],
  ['backend/app/routers/public.py', 'API untuk website (tracking, lead, rekomendasi)'],
  ['backend/app/routers/admin.py', 'API dashboard admin'],
  ['backend/ml/train.py', 'Perintah pelatihan model'],
  ['backend/jobs/gsc_etl.py', 'ETL Google Search Console'],
  ['backend/jobs/scheduler.py', 'Penjadwal tugas rutin'],
  ['backend/scripts/create_admin.py', 'Pembuatan akun admin'],
  ['backend/app/static/tracker.js', 'Script pelacak di website'],
  ['backend/app/static/dashboard/index.html', 'Struktur halaman dashboard'],
  ['backend/app/static/dashboard/style.css', 'Tampilan dashboard'],
  ['backend/app/static/dashboard/app.js', 'Logika dashboard admin'],
  ['integration/wordpress/ysii-tracker/ysii-tracker.php', 'Plugin WordPress'],
  ['backend/Dockerfile', 'Image kontainer aplikasi'],
  ['docker-compose.yml', 'Orkestrasi layanan'],
  ['nginx/templates/default.conf.template', 'Konfigurasi server web'],
];
module.exports = { SOURCE_FILES };
