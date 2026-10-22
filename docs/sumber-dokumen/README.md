# Skrip Pembuat Dokumen

| Skrip | Menghasilkan |
|---|---|
| `build_deskripsi_hki.js` | Deskripsi Program Komputer (HKI) |
| `build_kode_sumber.js` | PDF kode sumber lengkap & halaman awal/akhir (urutan berkas di `daftar_kode.js`) |
| `build_uat_sus.js` | Instrumen UAT & kuesioner SUS (data di `data_uat_sus.json`) |
| `build_kalkulator.py` | Kalkulator SUS & rekap UAT (.xlsx) |
| `build_notebook.py` | `backend/notebooks/analisis_jurnal.ipynb` |
| `docx_ke_pdf.py` | Mengisi daftar isi & mengekspor DOCX ke PDF (LibreOffice) |

Butuh Node.js (`docx`, `playwright`), Python (`openpyxl`, `nbformat`), dan LibreOffice. Contoh:

```bash
NODE_PATH=$(npm root -g) node build_uat_sus.js keluaran/
python3 docx_ke_pdf.py keluaran/Instrumen-UAT.docx keluaran/Instrumen-UAT-final.docx keluaran/Instrumen-UAT.pdf
python3 build_kalkulator.py keluaran/Kalkulator-SUS-dan-Rekap-UAT.xlsx
```

Skenario UAT dan butir SUS cukup diubah di `data_uat_sus.json`; dokumen Word dan kalkulator Excel ikut menyesuaikan.
