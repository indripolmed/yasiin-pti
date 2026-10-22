import sys
import nbformat as nbf

OUT = sys.argv[1]
cells = []
md = lambda s: cells.append(nbf.v4.new_markdown_cell(s.strip()))
code = lambda s: cells.append(nbf.v4.new_code_cell(s.strip()))

md(r"""
# Analisis Model Prediksi untuk Artikel Jurnal

**Sistem Promosi Digital Terintegrasi Berbasis SEO dan Machine Learning untuk Prediksi Perilaku Calon Peserta Pelatihan**

Notebook ini menghasilkan tabel dan gambar untuk bagian *Hasil dan Pembahasan* artikel:

1. Pemahaman data: jumlah data, ketidakseimbangan kelas, dan perbedaan perilaku antar kelas
2. Perbandingan **Logistic Regression**, **Random Forest**, dan **Gradient Boosting** dengan *repeated stratified k-fold cross-validation*
3. Uji statistik perbedaan antar algoritma (Friedman dan Wilcoxon dengan koreksi Holm)
4. Evaluasi pada data uji: **confusion matrix**, **kurva ROC**, dan **kurva Precision–Recall**
5. Analisis ambang dan segmen Hot/Warm/Cold
6. **Feature importance** (permutation importance)
7. Ekspor tabel (CSV) dan gambar (PNG 300 dpi), serta draf kalimat hasil

Pipeline (praproses + algoritma) diimpor langsung dari `app/ml_engine.py`, sehingga identik dengan model yang berjalan di sistem.

## Menyiapkan data

Ekspor dataset fitur dari server (data **nyata**, bukan simulasi):

```bash
docker compose exec api python -m ml.train --task lead    --export-dataset /app/models/lead.csv
docker compose exec api python -m ml.train --task visitor --export-dataset /app/models/visitor.csv
docker compose cp api:/app/models/lead.csv backend/notebooks/data/
```

Tugas `lead` menjawab *"lead mana yang akan menjadi peserta?"*. Tugas `visitor` menjawab *"pengunjung mana yang akan menjadi lead?"*. Jalankan notebook sekali untuk setiap tugas (ubah `TASK`).
""")

code(r"""
# ===================== PARAMETER =====================
TASK = "lead"                          # "lead" atau "visitor"
DATA_CSV = f"data/{TASK}.csv"          # hasil --export-dataset
OUTPUT_DIR = f"hasil/{TASK}"           # folder tabel & gambar
N_SPLITS, N_REPEATS = 5, 5             # repeated stratified k-fold
TEST_SIZE = 0.20
SEED = 42
HOT, WARM = 0.70, 0.40                 # ambang segmen (sama dengan sistem)
KRITERIA = "f1"                        # pemilihan model terbaik: "f1" (sama dengan sistem) atau "roc_auc"
DATA_SIMULASI = False                  # True hanya untuk uji coba notebook dengan data simulasi
""")

code(r"""
import sys, warnings
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy import stats
from sklearn.base import clone
from sklearn.dummy import DummyClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, auc, average_precision_score, balanced_accuracy_score, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score, recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate, train_test_split

warnings.filterwarnings("ignore", category=UserWarning)
sys.path.insert(0, str(Path.cwd().parent))          # folder backend/
from app.features import task_features
from app.ml_engine import ALGORITHMS, _pipeline

OUT = Path(OUTPUT_DIR); (OUT / "gambar").mkdir(parents=True, exist_ok=True); (OUT / "tabel").mkdir(exist_ok=True)

NAMA = {"logistic_regression": "Logistic Regression", "random_forest": "Random Forest", "gradient_boosting": "Gradient Boosting"}
# Palet kategorikal tervalidasi buta warna; garis juga dibedakan gaya-nya (aman untuk cetak hitam-putih)
WARNA = {"logistic_regression": "#2a78d6", "random_forest": "#eb6834", "gradient_boosting": "#1baf7a"}
GARIS = {"logistic_regression": "-", "random_forest": "--", "gradient_boosting": ":"}
plt.rcParams.update({
    "figure.dpi": 110, "savefig.dpi": 300, "savefig.bbox": "tight", "font.size": 10,
    "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": "#8a8a86",
    "axes.grid": True, "grid.color": "#e6e6e3", "grid.linewidth": 0.6, "axes.axisbelow": True,
    "axes.titlesize": 11, "axes.titleweight": "bold", "legend.frameon": False,
})
def simpan(fig, nama):
    fig.savefig(OUT / "gambar" / f"{nama}.png"); print("disimpan:", OUT / "gambar" / f"{nama}.png")
def tabel(df, nama):
    df.to_csv(OUT / "tabel" / f"{nama}.csv", index=True); print("disimpan:", OUT / "tabel" / f"{nama}.csv")
""")

md("## 1. Pemahaman Data")
code(r"""
df = pd.read_csv(DATA_CSV)
NUM, CAT = task_features(TASK)
X, y = df[NUM + CAT], df["y"].astype(int).to_numpy()
pos = int(y.sum())
print(f"Tugas: {TASK} | data: {len(df)} | positif: {pos} ({pos/len(df):.1%}) | negatif: {len(df)-pos}")
print(f"Fitur: {len(NUM)} numerik, {len(CAT)} kategorikal")
if DATA_SIMULASI:
    print("\n⚠ DATA SIMULASI — hasil hanya untuk menguji notebook, BUKAN hasil penelitian.")
ringkas = pd.DataFrame({"Jumlah data": [len(df)], "Positif": [pos], "Negatif": [len(df) - pos],
                        "Proporsi positif": [round(pos / len(df), 4)]})
tabel(ringkas, "01_ringkasan_data"); ringkas
""")
code(r"""
# Perbedaan perilaku antar kelas: median per kelas + uji Mann–Whitney U + effect size (rank-biserial)
rows = []
for f in NUM:
    a, b = df.loc[df.y == 1, f], df.loc[df.y == 0, f]
    if a.nunique() + b.nunique() <= 2:
        continue
    u, p = stats.mannwhitneyu(a, b, alternative="two-sided")
    rows.append({"Fitur": f, "Rata-rata (positif)": a.mean(), "Rata-rata (negatif)": b.mean(),
                 "Median (positif)": a.median(), "Median (negatif)": b.median(),
                 "r rank-biserial": 1 - 2 * u / (len(a) * len(b)), "p-value": p})
beda = pd.DataFrame(rows).set_index("Fitur").sort_values("r rank-biserial", key=abs, ascending=False).round(4)
tabel(beda, "02_perbedaan_perilaku_antar_kelas"); beda.head(15)
""")

md("""
## 2. Perbandingan Algoritma (Repeated Stratified k-Fold CV)

Data dibagi **80% latih** dan **20% uji** secara bertingkat. Validasi silang hanya memakai data latih. *DummyClassifier* (selalu menebak kelas mayoritas) disertakan sebagai pembanding minimum. Pada data tidak seimbang, akurasi dan F1 kelas positif dapat tampak tinggi untuk tebakan trivial, sehingga **balanced accuracy**, **F1 makro**, dan **AUC** juga dilaporkan.
""")
code(r"""
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=TEST_SIZE, stratify=y, random_state=SEED)
cv = RepeatedStratifiedKFold(n_splits=N_SPLITS, n_repeats=N_REPEATS, random_state=SEED)
METRIK = {"accuracy": "Akurasi", "balanced_accuracy": "Balanced accuracy", "precision": "Presisi", "recall": "Recall",
          "f1": "F1-score", "f1_macro": "F1 makro", "roc_auc": "AUC"}

model = {k: _pipeline(k, TASK) for k in ALGORITHMS}
model_dummy = clone(model["logistic_regression"]).set_params(clf=DummyClassifier(strategy="most_frequent"))
skor = {}
for k, m in {**model, "dummy": model_dummy}.items():
    r = cross_validate(m, X_tr, y_tr, cv=cv, scoring=list(METRIK), n_jobs=-1)
    skor[k] = {mt: r[f"test_{mt}"] for mt in METRIK}
NAMA_ALL = {**NAMA, "dummy": "Baseline (kelas mayoritas)"}
hasil_cv = pd.DataFrame({NAMA_ALL[k]: {METRIK[mt]: f"{v.mean():.3f} ± {v.std(ddof=1):.3f}" for mt, v in s.items()}
                         for k, s in skor.items()}).T
tabel(hasil_cv, "03_perbandingan_cv")
print(f"{N_SPLITS}-fold × {N_REPEATS} ulangan = {N_SPLITS*N_REPEATS} skor per algoritma (rata-rata ± simpangan baku)")
hasil_cv
""")
code(r"""
LAIN = "roc_auc" if KRITERIA == "f1" else "f1"
TERBAIK = max(ALGORITHMS, key=lambda k: (skor[k][KRITERIA].mean(), skor[k][LAIN].mean()))
print(f"Algoritma terbaik berdasarkan {METRIK[KRITERIA]} rata-rata:", NAMA[TERBAIK])
if y.mean() > 0.5:
    print("Catatan: kelas positif adalah MAYORITAS. F1 kelas positif tinggi bahkan untuk tebakan 'semua positif'; "
          "gunakan AUC, balanced accuracy, dan F1 makro sebagai pembanding utama, dan pertimbangkan KRITERIA = 'roc_auc'.")

# Sebaran F1 per lipatan (boxplot) — satu sumbu, satu ukuran
fig, ax = plt.subplots(figsize=(6.2, 3.2))
data = [skor[k]["f1"] for k in ALGORITHMS]
bp = ax.boxplot(data, vert=False, widths=0.5, patch_artist=True, medianprops={"color": "#0b0b0b", "linewidth": 1.4})
for patch, k in zip(bp["boxes"], ALGORITHMS):
    patch.set_facecolor(WARNA[k]); patch.set_alpha(0.75); patch.set_edgecolor("#52514e")
ax.set_yticks(range(1, len(ALGORITHMS) + 1), [NAMA[k] for k in ALGORITHMS])
ax.set_xlabel("F1-score per lipatan validasi silang"); ax.set_title("Sebaran F1-score antar lipatan")
ax.grid(axis="y", visible=False)
simpan(fig, "01_boxplot_f1_cv"); plt.show()
""")

md("""
## 3. Uji Statistik Antar Algoritma

**Uji Friedman** menguji apakah ada perbedaan F1 di antara ketiga algoritma pada lipatan yang sama. Jika signifikan, dilanjutkan **uji Wilcoxon signed-rank** berpasangan dengan **koreksi Holm**.

> Catatan metodologi: skor antar lipatan tidak sepenuhnya independen karena data latihnya beririsan, sehingga nilai p bersifat indikatif. Sebutkan keterbatasan ini di artikel.
""")
code(r"""
for mt in ["f1", "roc_auc"]:
    arr = [skor[k][mt] for k in ALGORITHMS]
    chi, p = stats.friedmanchisquare(*arr)
    print(f"Friedman ({METRIK[mt]}): χ² = {chi:.3f}, p = {'< 0,001' if p < 0.001 else f'{p:.4f}'}")
pasang, pv = [], []
keys = list(ALGORITHMS)
for i in range(len(keys)):
    for j in range(i + 1, len(keys)):
        a, b = skor[keys[i]]["f1"], skor[keys[j]]["f1"]
        w, p = stats.wilcoxon(a, b) if np.any(a != b) else (np.nan, 1.0)
        pasang.append((NAMA[keys[i]], NAMA[keys[j]], (a - b).mean(), w)); pv.append(p)
urut = np.argsort(pv); holm = np.empty(len(pv)); m = len(pv); run = 0
for r, idx in enumerate(urut):
    run = max(run, min(1, (m - r) * pv[idx])); holm[idx] = run
fmt_p = lambda v: "< 0,001" if v < 0.001 else f"{v:.4f}".replace(".", ",")
uji = pd.DataFrame([{"Algoritma A": a, "Algoritma B": b, "Selisih rata-rata F1 (A−B)": round(d, 4), "W": w,
                     "p": fmt_p(p), "p (Holm)": fmt_p(h), "Signifikan (α=0,05)": "Ya" if h < 0.05 else "Tidak"}
                    for (a, b, d, w), p, h in zip(pasang, pv, holm)])
tabel(uji.set_index("Algoritma A"), "04_uji_wilcoxon_holm"); uji
""")

md("## 4. Evaluasi pada Data Uji (20%)")
code(r"""
fitted, proba = {}, {}
for k in ALGORITHMS:
    fitted[k] = clone(model[k]).fit(X_tr, y_tr)
    proba[k] = fitted[k].predict_proba(X_te)[:, 1]
def metrik_uji(p, thr=0.5):
    pred = (p >= thr).astype(int)
    return {"Akurasi": accuracy_score(y_te, pred), "Balanced accuracy": balanced_accuracy_score(y_te, pred),
            "Presisi": precision_score(y_te, pred, zero_division=0),
            "Recall": recall_score(y_te, pred, zero_division=0), "F1-score": f1_score(y_te, pred, zero_division=0),
            "F1 makro": f1_score(y_te, pred, average="macro", zero_division=0),
            "AUC": roc_auc_score(y_te, p), "Average precision": average_precision_score(y_te, p)}
hasil_uji = pd.DataFrame({NAMA[k]: metrik_uji(proba[k]) for k in ALGORITHMS}).T.round(4)
tabel(hasil_uji, "05_hasil_data_uji"); hasil_uji
""")
code(r"""
# Confusion matrix — satu ramp sekuensial (biru), angka di setiap sel
from matplotlib.colors import LinearSegmentedColormap
BIRU = LinearSegmentedColormap.from_list("biru", ["#f5f9fe", "#cde2fb", "#86b6ef", "#2a78d6", "#184f95"])
fig, axes = plt.subplots(1, 3, figsize=(10, 3.3))
for ax, k in zip(axes, ALGORITHMS):
    cm = confusion_matrix(y_te, (proba[k] >= 0.5).astype(int), labels=[0, 1])
    ax.imshow(cm, cmap=BIRU, vmin=0, vmax=cm.max())
    for (i, j), v in np.ndenumerate(cm):
        ax.text(j, i, f"{v}\n({v / cm.sum():.1%})", ha="center", va="center", fontsize=9,
                color="#ffffff" if v > cm.max() * 0.6 else "#0b0b0b")
    ax.set_xticks([0, 1], ["Negatif", "Positif"]); ax.set_yticks([0, 1], ["Negatif", "Positif"])
    ax.set_xlabel("Prediksi"); ax.set_ylabel("Aktual"); ax.set_title(NAMA[k]); ax.grid(False)
fig.suptitle("Confusion matrix pada data uji (ambang 0,5)", fontweight="bold", y=1.03)
fig.tight_layout(); simpan(fig, "02_confusion_matrix"); plt.show()
""")
code(r"""
# Kurva ROC dan Precision–Recall (dua gambar terpisah, masing-masing satu sumbu)
fig, ax = plt.subplots(figsize=(4.8, 4.4))
for k in ALGORITHMS:
    fpr, tpr, _ = roc_curve(y_te, proba[k])
    ax.plot(fpr, tpr, GARIS[k], color=WARNA[k], lw=2, label=f"{NAMA[k]} (AUC = {auc(fpr, tpr):.3f})")
ax.plot([0, 1], [0, 1], color="#8a8a86", lw=1, ls=(0, (2, 3)), label="Tebakan acak (AUC = 0,5)")
ax.set_xlabel("False positive rate"); ax.set_ylabel("True positive rate (recall)")
ax.set_title("Kurva ROC pada data uji"); ax.set_xlim(0, 1); ax.set_ylim(0, 1.01); ax.legend(loc="lower right", fontsize=8.5)
simpan(fig, "03_kurva_roc"); plt.show()

fig, ax = plt.subplots(figsize=(4.8, 4.4))
for k in ALGORITHMS:
    pr, rc, _ = precision_recall_curve(y_te, proba[k])
    ax.plot(rc, pr, GARIS[k], color=WARNA[k], lw=2, label=f"{NAMA[k]} (AP = {average_precision_score(y_te, proba[k]):.3f})")
ax.axhline(y_te.mean(), color="#8a8a86", lw=1, ls=(0, (2, 3)), label=f"Proporsi positif ({y_te.mean():.2f})")
ax.set_xlabel("Recall"); ax.set_ylabel("Presisi"); ax.set_title("Kurva Precision–Recall pada data uji")
ax.set_xlim(0, 1); ax.set_ylim(0, 1.01); ax.legend(loc="lower left", fontsize=8.5)
simpan(fig, "04_kurva_precision_recall"); plt.show()
""")

md("""
## 5. Ambang Keputusan dan Segmen Hot/Warm/Cold

Sistem mengelompokkan skor menjadi **Hot** (≥ 0,70), **Warm** (0,40–0,69), dan **Cold** (< 0,40). Tabel berikut menguji apakah segmen tersebut benar-benar memisahkan peluang konversi pada data uji. Segmen yang baik menghasilkan tingkat konversi aktual **Hot > Warm > Cold**.
""")
code(r"""
p = proba[TERBAIK]
seg = np.where(p >= HOT, "Hot", np.where(p >= WARM, "Warm", "Cold"))
segmen = (pd.DataFrame({"Segmen": seg, "y": y_te}).groupby("Segmen")["y"]
          .agg(Jumlah="count", Positif="sum").reindex(["Hot", "Warm", "Cold"]).fillna(0))
segmen["Tingkat konversi aktual"] = (segmen["Positif"] / segmen["Jumlah"].replace(0, np.nan)).round(4)
segmen["Lift vs rata-rata"] = (segmen["Tingkat konversi aktual"] / y_te.mean()).round(2)
tabel(segmen, "06_konversi_per_segmen"); print("Model:", NAMA[TERBAIK]); segmen
""")
code(r"""
thr = np.linspace(0.05, 0.95, 91)
P = [precision_score(y_te, (p >= t).astype(int), zero_division=0) for t in thr]
R = [recall_score(y_te, (p >= t).astype(int), zero_division=0) for t in thr]
F = [f1_score(y_te, (p >= t).astype(int), zero_division=0) for t in thr]
t_best = thr[int(np.argmax(F))]
fig, ax = plt.subplots(figsize=(6.2, 3.6))
ax.plot(thr, P, "-", color="#2a78d6", lw=2, label="Presisi")
ax.plot(thr, R, "--", color="#eb6834", lw=2, label="Recall")
ax.plot(thr, F, ":", color="#1baf7a", lw=2.2, label="F1-score")
for t, lab in [(WARM, "Warm"), (HOT, "Hot")]:
    ax.axvline(t, color="#8a8a86", lw=0.8)
    ax.text(t, 1.04, f"batas {lab}", fontsize=8, color="#52514e", ha="center", transform=ax.get_xaxis_transform())
ax.set_xlabel("Ambang skor"); ax.set_ylabel("Nilai metrik"); ax.set_ylim(0, 1.02)
ax.set_title(f"Pengaruh ambang terhadap metrik — {NAMA[TERBAIK]}", pad=18)
ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.2), fontsize=8.5, ncol=3)
simpan(fig, "05_analisis_ambang"); plt.show()
print(f"Ambang dengan F1 tertinggi pada data uji: {t_best:.2f} (F1 = {max(F):.3f})")
""")

md("""
## 6. Feature Importance (Permutation Importance)

Nilai menunjukkan **penurunan AUC** pada data uji ketika nilai satu fitur diacak. Semakin besar penurunannya, semakin penting fitur tersebut. Garis galat menunjukkan simpangan baku dari 20 kali pengacakan.
""")
code(r"""
imp = permutation_importance(fitted[TERBAIK], X_te, y_te, scoring="roc_auc", n_repeats=20, random_state=SEED, n_jobs=-1)
fi = (pd.DataFrame({"Fitur": X.columns, "Penurunan AUC (rata-rata)": imp.importances_mean, "Simpangan baku": imp.importances_std})
      .sort_values("Penurunan AUC (rata-rata)", ascending=False).set_index("Fitur").round(4))
tabel(fi, "07_permutation_importance")
top = fi.head(12).iloc[::-1]
fig, ax = plt.subplots(figsize=(6.2, 4.2))
ax.barh(top.index, top["Penurunan AUC (rata-rata)"], xerr=top["Simpangan baku"], color="#2a78d6", height=0.62,
        error_kw={"ecolor": "#52514e", "elinewidth": 0.9, "capsize": 2})
ax.axvline(0, color="#52514e", lw=0.8); ax.grid(axis="y", visible=False)
ax.set_xlabel("Penurunan AUC saat fitur diacak"); ax.set_title(f"12 fitur terpenting — {NAMA[TERBAIK]}")
simpan(fig, "06_feature_importance"); plt.show()
fi.head(12)
""")

md("## 7. Draf Kalimat Hasil")
code(r"""
b = TERBAIK; cvb = skor[b]; u = hasil_uji.loc[NAMA[b]]
d = {mt: skor["dummy"][mt].mean() for mt in METRIK}
if y.mean() > 0.5:
    kalimat_baseline = (f"Karena kelas positif merupakan mayoritas, baseline yang selalu menebak positif sudah memperoleh akurasi "
        f"{d['accuracy']:.3f} dan F1-score {d['f1']:.3f}; oleh karena itu keunggulan model dinilai dari AUC "
        f"({cvb['roc_auc'].mean():.3f} vs 0,5), balanced accuracy ({cvb['balanced_accuracy'].mean():.3f} vs {d['balanced_accuracy']:.3f}), "
        f"dan F1 makro ({cvb['f1_macro'].mean():.3f} vs {d['f1_macro']:.3f}).")
else:
    kalimat_baseline = (f"Sebagai pembanding, baseline kelas mayoritas mencapai akurasi {d['accuracy']:.3f} namun F1-score {d['f1']:.3f}, "
        f"sehingga akurasi saja tidak memadai untuk menilai model pada data tidak seimbang; model terbaik mencapai balanced accuracy "
        f"{cvb['balanced_accuracy'].mean():.3f} dan F1 makro {cvb['f1_macro'].mean():.3f}.")
uji_sig = uji[uji["Signifikan (α=0,05)"] == "Ya"]
fitur3 = ", ".join(f"`{f}`" for f in fi.index[:3])
seg_txt = "; ".join(f"{s} {segmen.loc[s, 'Tingkat konversi aktual']:.1%} (n={int(segmen.loc[s, 'Jumlah'])})"
                    for s in segmen.index if segmen.loc[s, "Jumlah"] > 0)
teks = f'''
Dataset terdiri atas {len(df)} observasi dengan {pos} kelas positif ({pos/len(df):.1%}). Evaluasi menggunakan
{N_SPLITS}-fold stratified cross-validation yang diulang {N_REPEATS} kali pada {1-TEST_SIZE:.0%} data latih, serta
{TEST_SIZE:.0%} data uji terpisah. {NAMA[b]} memperoleh {METRIK[KRITERIA]} rata-rata tertinggi, dengan F1-score {cvb['f1'].mean():.3f} ± {cvb['f1'].std(ddof=1):.3f}
dan AUC {cvb['roc_auc'].mean():.3f} ± {cvb['roc_auc'].std(ddof=1):.3f}. Pada data uji, model ini mencapai akurasi {u['Akurasi']:.3f},
balanced accuracy {u['Balanced accuracy']:.3f}, presisi {u['Presisi']:.3f}, recall {u['Recall']:.3f}, F1-score {u['F1-score']:.3f},
F1 makro {u['F1 makro']:.3f}, dan AUC {u['AUC']:.3f}.
{kalimat_baseline}
Uji Friedman dan Wilcoxon (koreksi Holm) menunjukkan {len(uji_sig)} dari {len(uji)} pasangan algoritma berbeda signifikan pada α = 0,05.
Fitur yang paling berpengaruh adalah {fitur3}. Tingkat konversi aktual per segmen pada data uji: {seg_txt}.
'''
if DATA_SIMULASI:
    teks = "[DATA SIMULASI — JANGAN DIKUTIP]\n" + teks
(OUT / "draf_kalimat_hasil.txt").write_text(teks.strip()); print(teks)
""")

md("""
## Catatan Pelaporan

- Laporkan **F1-score, recall, dan AUC** sebagai metrik utama; akurasi sebagai pelengkap.
- Sebutkan bahwa fitur dihitung dari perilaku **sebelum** pengunjung mendaftar (pencegahan kebocoran label), dan bahwa untuk tugas `visitor` fitur klik WhatsApp dan mulai mengisi form dikeluarkan.
- Cantumkan periode pengumpulan data, jumlah data, proporsi kelas, dan seed acak (`SEED`) agar hasil dapat direplikasi.
- Seluruh tabel ada di `hasil/<tugas>/tabel/` dan gambar (PNG 300 dpi) di `hasil/<tugas>/gambar/`.
""")

nb = nbf.v4.new_notebook(); nb["cells"] = cells
nb["metadata"] = {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
                  "language_info": {"name": "python"}}
nbf.write(nb, OUT); print("OK", OUT, len(cells), "sel")
