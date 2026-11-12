# Benchmark board

Part 2 of the PRD judges every milestone first by these boards, then by tests.

## Run it

```text
pnpm bench
```

It builds the two benchmark characters, Mara and Cole, and renders them:

- in the three quality profiles;
- under the two benchmark looks, Interior flashlight and Village overcast;
- from four cameras: three-quarter, full body, profile and back;

once in the app and once in Unity (when Unity 6 is installed; set `PS2CC_UNITY` to `Unity.exe` if it is not found).

The results go to `docs/bench/latest/` (git-ignored):

| File | What it is |
| --- | --- |
| `board_mara.png`, `board_cole.png` | The boards, with your references beside them |
| `app/` | App renders, as on the boards |
| `parity/`, `unity/`, `diff/` | The parity check: app and Unity renders of the same view, and their difference |
| `bench_report.json` | Parity (SSIM per view, passing at 0.9) and regression against the accepted board |
| `app_report.json` | Bake time and triangle count per character and profile |
| `characters/` | The characters as `.ps2char` files, to open in PS2CC |
| `score_template.json` | Scores to fill in |

The test machine's GPU is software, so `pnpm bench` bakes smaller maps than the app does. Set `PS2CC_BENCH_BAKE=full` to bake at the app's own size.

## Your references

Put screenshots of the games you compare with in `refs/mara/` and `refs/cole/`, as PNG files. They appear on the right of each board. `refs/` is git-ignored and CI fails if an image is ever committed under a `refs/` folder: never move them elsewhere in the repository.

## Score and accept

1. Copy `score_template.json` into `docs/bench/scores.json` (one entry per board).
2. Rate each criterion 1 to 5: silhouette, hair, face, eyes, skin, clothing, lighting and mood, overall.

A milestone passes when its target criteria rise and none falls.

When a board is accepted, run:

```text
pnpm bench -- --accept
```

It copies the board to `docs/bench/accepted/`. Later runs flag every region that changed by more than 8% from it.
