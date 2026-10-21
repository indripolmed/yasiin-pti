"""Latih & bandingkan Logistic Regression, Random Forest, Gradient Boosting.

Tugas:
  lead    = lead -> menjadi peserta (prioritas lead di dashboard)
  visitor = pengunjung -> menjadi lead (rekomendasi & CTA di website)

    python -m ml.train                         # semua tugas yang datanya cukup
    python -m ml.train --task lead --force     # paksa walau data sedikit
    python -m ml.train --task lead --export-dataset lead.csv   # dataset untuk notebook
"""

import argparse
import json

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.ml_engine import TASKS, InsufficientDataError, build_dataset, train_models


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--task", choices=["all", *TASKS], default="all")
    p.add_argument("--force", action="store_true", help="Latih walau contoh positif di bawah batas minimal")
    p.add_argument("--no-activate", action="store_true", help="Simpan model tanpa mengaktifkannya")
    p.add_argument("--export-dataset", metavar="CSV", help="Hanya ekspor dataset fitur ke CSV")
    args = p.parse_args()

    init_db()
    tasks = list(TASKS) if args.task == "all" else [args.task]
    with SessionLocal() as db:
        if args.export_dataset:
            for task in tasks:
                df = build_dataset(db, task)
                path = args.export_dataset if len(tasks) == 1 else f"{task}-{args.export_dataset}"
                df.to_csv(path, index=False)
                print(f"[{task}] {len(df)} baris ({int(df['y'].sum()) if len(df) else 0} positif) -> {path}")
            return
        for task in tasks:
            try:
                report = train_models(db, task=task, force=args.force, activate=not args.no_activate)
            except InsufficientDataError as exc:
                print(f"\n{exc}")
                continue
            _print(report, activated=not args.no_activate)


def _print(report: dict, activated: bool) -> None:
    print(f"\n=== {report['task_label']} ===")
    print(f"Data: {report['n_samples']} ({report['n_positive']} positif) | {report['cv_folds']}-fold stratified CV\n")
    print(f"{'Algoritma':<22}{'Akurasi':>9}{'Presisi':>9}{'Recall':>9}{'F1':>9}{'AUC':>9}{'F1 uji':>9}{'AUC uji':>9}")
    for name, r in report["comparison"].items():
        cv, ho = r["cv"], r["holdout"]
        star = " *" if name == report["best_algorithm"] else ""
        print(f"{name + star:<22}{cv['accuracy']:>9}{cv['precision']:>9}{cv['recall']:>9}{cv['f1']:>9}"
              f"{cv['roc_auc']:>9}{ho['f1']:>9}{ho.get('roc_auc', '-'):>9}")
    print("\nFitur terpenting:")
    for f in report["feature_importance"][:8]:
        print(f"  {f['feature']:<28}{f['importance']}")
    print(f"\nModel disimpan{'' if activated else ' (tidak diaktifkan)'}: {report['version']}")
    if "rescored_leads" in report:
        print(f"Skor {report['rescored_leads']} lead yang masih berjalan diperbarui.")
    with open(get_settings().model_dir / f"{report['version']}.report.json", "w") as fh:
        json.dump(report, fh, indent=2)


if __name__ == "__main__":
    main()
