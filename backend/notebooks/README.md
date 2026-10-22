# Notebook Analisis untuk Artikel Jurnal

`analisis_jurnal.ipynb` menghasilkan tabel (CSV) dan gambar (PNG 300 dpi) untuk bagian *Hasil dan Pembahasan*:
perbandingan Logistic Regression / Random Forest / Gradient Boosting (repeated stratified k-fold),
uji Friedman & Wilcoxon-Holm, confusion matrix, kurva ROC & Precision–Recall, analisis ambang dan segmen
Hot/Warm/Cold, permutation importance, serta draf kalimat hasil.

## Menjalankan

```bash
cd backend
pip install -r requirements-notebook.txt

# ekspor data NYATA dari server (lihat juga sel pertama notebook)
docker compose exec api python -m ml.train --task lead    --export-dataset /app/models/lead.csv
docker compose exec api python -m ml.train --task visitor --export-dataset /app/models/visitor.csv
docker compose cp api:/app/models/lead.csv    notebooks/data/
docker compose cp api:/app/models/visitor.csv notebooks/data/

cd notebooks && jupyter lab analisis_jurnal.ipynb
```

Ubah `TASK` di sel parameter (`lead` lalu `visitor`) dan jalankan semua sel. Hasil tersimpan di `notebooks/hasil/<tugas>/`.

- Folder `data/` dan `hasil/` tidak di-commit karena berisi data operasional mitra.
- Pipeline diimpor dari `app/ml_engine.py`, sehingga sama dengan model yang berjalan di sistem.
- Untuk uji coba dengan data simulasi, set `DATA_SIMULASI = True`; semua keluaran akan ditandai **jangan dikutip**.
