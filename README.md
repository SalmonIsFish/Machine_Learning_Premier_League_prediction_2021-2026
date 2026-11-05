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

## Prediction game: You vs the Machine

Notebooks 03-06 turn the models into a game. You replay a past season gameweek by gameweek: you make your
predictions, the machine makes its own, and both are scored against what really happened. Any season from
2017-18 to 2025-26 can be played. The machine is always trained **only on earlier seasons**, so it never sees the answers.

| Notebook | Game | Scoring |
|---|---|---|
| `03_download_fpl.ipynb` | Downloads and checks the extra data (run this first) | |
| `04_score_predictor.ipynb` | Predict the score of every match in a gameweek | 3 pts exact score, 1 pt right result |
| `05_fantasy.ipynb` | Pick a 15-player FPL squad (£100m, max 3 per club) and a captain | real FPL points of your XI |
| `06_awards.ipynb` | Player of the Week, Player of the Season, Golden Boot, Playmaker, Golden Glove | 5 pts per correct award |

Change `SEASON` / `GW` at the top of a notebook, fill in your picks, and run the reveal cell.
Your results are saved in `game/` (not committed to git). Each notebook ends with a backtest that shows how good the machine is.

- **Score predictor:** the Poisson goal models give each team's expected goals. The machine picks the scoreline with
  the most expected points, which beats always picking "1-0 home" in every season.
- **Fantasy:** a gradient-boosting model predicts each player's FPL points from their last 5 gameweeks, price, position,
  and fixture difficulty (Elo, expected goals). The machine then builds the best squad it can afford.
- **Awards:** points, goals, assists and clean sheets so far, projected over the remaining fixtures with the team models.

The shared code (data loading, features, Elo, models, squad rules) lives in `src/pl.py`.

## Project structure

```
Machine_Learning/
├── Datasets/
│   ├── Premier_League_Team_Statistics_2021-2026/   # one CSV per season, 2016-17 to 2025-26 (380 matches each)
│   ├── Player_Statistics_2021-2026/                # player season statistics (Excel)
│   ├── FPL_Gameweek_2016-2026/                     # per-gameweek FPL player stats (downloaded by notebook 03)
│   └── processed/                                  # model-ready table written by notebook 01
├── notebooks/
│   ├── 01_explore.ipynb                            # cleaning, features, Elo, models
│   ├── 02_players_explore.ipynb                    # player season stats and fantasy points
│   ├── 03_download_fpl.ipynb                       # prediction game: data download + checks
│   ├── 04_score_predictor.ipynb                    # prediction game: match scores
│   ├── 05_fantasy.ipynb                            # prediction game: fantasy team
│   └── 06_awards.ipynb                             # prediction game: awards
├── src/pl.py                                       # shared code for notebooks 03-06
├── game/                                           # your saved game results (created when you play)
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

- Match results 2016-17 to 2020-21: [football-data.co.uk](https://www.football-data.co.uk/englandm.php), converted to the same columns as the other season files.
- Per-gameweek FPL player data 2016-17 to 2025-26: [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League) (MIT licence), originally from the official Fantasy Premier League API.
- 2019-20 (from the June 2020 restart) and 2020-21 were played without crowds. Those matches have `No_Crowd = 1`, and Elo gives them no home advantage.

TODO: add the download links for the 2021-26 match CSVs and the player Excel files, and note the licence or terms of each source.

## Limitations

- Only one test season, and the Elo settings (K = 20, home advantage = 60) have not been tuned.
- The player files are season totals, which include the match being predicted, so they are not used for match prediction.
