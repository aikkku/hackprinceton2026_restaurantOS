# Expansion — local data (git-ignored)

This folder holds the real Expansion datasets. The actual data files are **git-ignored**
(see the repo root `.gitignore`) because they are large, restricted, or derived — so they do
**not** clone to another machine. This README is the tracked manifest: any clone shows exactly
what belongs here and how to obtain it.

| Path | What it is | Size | How to obtain |
|---|---|---|---|
| `costar-hackathon-kit (1)/` | CoStar hackathon dataset (JSONL + CSVs) | ~404 MB | CoStar keys card in the track Discord (zip + password). Restricted — do not commit. |
| `data/` | Working data from the old RestaurantOS backend: `costar.sqlite` (kit cache), `store.json`, `cache/`, `images/` (Vexcel chips), `runs/` | ~18 MB | Derived / regenerable — rebuild the SQLite from the kit, or re-run the old backend. |
| `quickstart/` | Matterport index of ~15k scans (`models_index.csv`) + two Matterport tutorial notebooks | ~2.6 MB | Matterport quickstart (`setup.ps1` downloads it). |
| `output/restaurants.csv` | One-off export of CoStar food tenancies | ~0.3 MB | `extract_restaurants.py` in the old repo. |

## To reproduce on another machine

1. `git clone` this repo — this README is present, the data files are not.
2. Get the **CoStar kit** from the hackathon card and place it at `costar-hackathon-kit (1)/`.
3. Get **models_index.csv** from the Matterport quickstart (or re-run the quickstart download).
4. `data/` and `output/` are derived; regenerate from the kit if needed.

Keep credentials in `.env` (git-ignored); never commit them.
