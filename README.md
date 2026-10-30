# Premier League Match Predictor

A beginner machine learning project that predicts Premier League match results (home win / draw / away win)
and the number of goals each team scores, using five seasons of data (2021-22 to 2025-26).

## Results

Trained on 2021-22 to 2024-25 and tested on the unseen 2025-26 season (375 matches).

**Match winner (accuracy)**

| Model | Accuracy |
|---|---|
| Always guess "home win" (baseline) | 42.4% |
| Logistic Regression, recent form only | 48.0% |
| Logistic Regression, Elo ratings only | 50.1% |
| Logistic Regression, form + Elo | 50.4% |

**Goals (Poisson regression, mean absolute error, lower is better)**

| | Baseline | Form + Elo |
|---|---|---|
| Home goals | 1.000 | 0.948 |
| Away goals | 0.909 | 0.857 |

These numbers come from a single test season, so luck alone can move accuracy by about 2.5 percentage points.
The model almost never predicts a draw, which is normal for football models.

## How it works

- **No leakage:** every feature for a match is built only from matches played before it
  (rolling average of a team's previous 5 matches, using `shift(1)`).
- **Features:** recent form (goals scored and conceded, shots, shots on target, corners, points) and an Elo rating
  for each team that is updated after every match.
- **Honest evaluation:** the data is split by date (older seasons for training, the newest season for testing),
  and every result is compared with a simple baseline.
- **Predict a match:** the last cells of the notebook contain `predict_match("Arsenal", "Chelsea")`,
  which prints win/draw/loss probabilities and expected goals. It uses data up to May 2026.

## Project structure

```
Machine_Learning/
├── Datasets/
│   ├── Premier_League_Team_Statistics_2021-2026/   # one CSV per season (380 matches each)
│   ├── Player_Statistics_2021-2026/                # player season statistics (Excel)
│   └── processed/                                  # model-ready table written by the notebook
├── notebooks/
│   └── 01_explore.ipynb                            # cleaning, features, Elo, models
├── requirements.txt
└── README.md
```

## Run it

```
pip install -r requirements.txt
```

Open `notebooks/01_explore.ipynb` in VS Code or Jupyter and choose Run All. Paths are relative to the
`notebooks/` folder, so run the notebook from there.

## Data

TODO: add the download links for the match CSVs and the player Excel files, and note the licence or terms of each source.

## Limitations

- Only one test season, and the Elo settings (K = 20, home advantage = 60) have not been tuned.
- The player files are season totals, which include the match being predicted, so they are not used for match prediction.
