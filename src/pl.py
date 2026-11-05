"""Shared code for the Premier League prediction game notebooks (03-06).

The match features (last-5 form + Elo) are the same as in notebooks/01_explore.ipynb,
moved here so every notebook uses one copy.

Season labels look like "2021-22" everywhere in this module.
"""
import os

os.environ.setdefault("LOKY_MAX_CPU_COUNT", "4")   # silences a harmless joblib warning on Windows

import difflib
import io
import math
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import PoissonRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

# --------------------------------------------------------------------------------------
# Paths and seasons
# --------------------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]
MATCH_DIR = ROOT / "Datasets" / "Premier_League_Team_Statistics_2021-2026"
FPL_DIR = ROOT / "Datasets" / "FPL_Gameweek_2016-2026"
GAME_DIR = ROOT / "game"

SEASONS = [f"{y}-{(y + 1) % 100:02d}" for y in range(2016, 2026)]   # 2016-17 ... 2025-26
PLAYABLE_SEASONS = SEASONS[1:]   # 2016-17 has no earlier season to train on


def season_code(season):
    """'2021-22' -> '2122' (the code used in file names)."""
    return season[2:4] + season[5:7]


def season_from_code(code):
    """'2122' -> '2021-22'."""
    return f"20{code[:2]}-{code[2:]}"


# --------------------------------------------------------------------------------------
# Downloads
# --------------------------------------------------------------------------------------
FPL_URL = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/{season}/{path}"
FPL_FILES = {"merged_gw.csv": "gws/merged_gw.csv", "players_raw.csv": "players_raw.csv"}
FD_URL = "https://www.football-data.co.uk/mmz4281/{code}/E0.csv"

# the columns (and order) of the existing season-*.csv files
MATCH_COLS = ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR", "HTHG", "HTAG", "HTR", "Referee",
              "HS", "AS", "HST", "AST", "HF", "AF", "HC", "AC", "HY", "AY", "HR", "AR"]


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "pl-prediction-game (python urllib)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def download_fpl(seasons=SEASONS):
    """Download per-gameweek player data (vaastav/Fantasy-Premier-League). Existing files are kept."""
    for season in seasons:
        for name, path in FPL_FILES.items():
            dest = FPL_DIR / season / name
            if dest.exists() and dest.stat().st_size > 0:
                print(f"have      {season}/{name}")
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(_fetch(FPL_URL.format(season=season, path=path)))
            print(f"download  {season}/{name}")


def download_old_matches(seasons=("2016-17", "2017-18", "2018-19", "2019-20", "2020-21")):
    """Download match results from football-data.co.uk and save them in the same format as season-2122.csv."""
    for season in seasons:
        dest = MATCH_DIR / f"season-{season_code(season)}.csv"
        if dest.exists():
            print(f"have      {dest.name}")
            continue
        raw = pd.read_csv(io.BytesIO(_fetch(FD_URL.format(code=season_code(season)))), encoding="latin-1")
        raw = raw.dropna(subset=["HomeTeam"])
        # dates are dd/mm/yy in some seasons and dd/mm/yyyy in others
        d = pd.to_datetime(raw["Date"], format="%d/%m/%Y", errors="coerce")
        d = d.fillna(pd.to_datetime(raw["Date"], format="%d/%m/%y", errors="coerce"))
        raw["Date"] = d.dt.strftime("%Y-%m-%d")
        raw[MATCH_COLS].to_csv(dest, index=False)
        print(f"download  {dest.name} ({len(raw)} matches)")


# --------------------------------------------------------------------------------------
# Matches: load, form features, Elo  (same logic as notebooks/01_explore.ipynb)
# --------------------------------------------------------------------------------------
RENAME = {
    "HomeTeam": "Home_Team", "AwayTeam": "Away_Team", "FTHG": "Home_Goals", "FTAG": "Away_Goals",
    "FTR": "Full_Time_Result", "HTHG": "Half_Time_Home_Goals", "HTAG": "Half_Time_Away_Goals",
    "HTR": "Half_Time_Result", "HS": "Home_Shots", "AS": "Away_Shots", "HST": "Home_Shots_On_Target",
    "AST": "Away_Shots_On_Target", "HF": "Home_Fouls", "AF": "Away_Fouls", "HC": "Home_Corners",
    "AC": "Away_Corners", "HY": "Home_Yellow_Cards", "AY": "Away_Yellow_Cards", "HR": "Home_Red_Cards",
    "AR": "Away_Red_Cards",
}

# Matches played behind closed doors (COVID): from the June 2020 restart to the end of 2020-21.
NO_CROWD_FROM, NO_CROWD_TO = "2020-06-01", "2021-05-31"

FORM_STATS = ["Goals_For", "Goals_Against", "Shots", "Shots_On_Target", "Corners", "Points"]
FORM_COLS = [f"Home_{s}_Last5" for s in FORM_STATS] + [f"Away_{s}_Last5" for s in FORM_STATS]
ELO_COLS = ["Home_Elo", "Away_Elo", "Elo_Diff"]
MATCH_FEATURES = FORM_COLS + ELO_COLS + ["No_Crowd"]

ELO_K = 20          # how fast ratings move
ELO_HOME_ADV = 60   # extra rating points for the home team (0 when there is no crowd)


def load_matches():
    """All season-*.csv files as one table, sorted by date, with readable column names."""
    frames = []
    for f in sorted(MATCH_DIR.glob("season-*.csv")):
        df = pd.read_csv(f)
        df["Season"] = season_from_code(f.stem.split("-")[1])
        frames.append(df)
    m = pd.concat(frames, ignore_index=True)
    m["Date"] = pd.to_datetime(m["Date"], format="%Y-%m-%d")
    m = m.rename(columns=RENAME).sort_values(["Date", "Home_Team"]).reset_index(drop=True)
    # Known typo in the source file: West Ham had 9 shots on target but only 8 shots (2021-08-15)
    m.loc[(m["Date"] == "2021-08-15") & (m["Home_Team"] == "Newcastle"), "Away_Shots"] = 9
    m["No_Crowd"] = m["Date"].between(NO_CROWD_FROM, NO_CROWD_TO).astype(int)
    m["Match_ID"] = m.index
    return m


def build_team_games(matches):
    """One row per team per match, with the average of the team's previous 5 matches (shift(1) = no leakage)."""
    cols = ["Match_ID", "Date", "Season", "Team", "Opponent", "Goals_For", "Goals_Against",
            "Shots", "Shots_On_Target", "Corners"]
    home = matches.rename(columns={
        "Home_Team": "Team", "Away_Team": "Opponent", "Home_Goals": "Goals_For", "Away_Goals": "Goals_Against",
        "Home_Shots": "Shots", "Home_Shots_On_Target": "Shots_On_Target", "Home_Corners": "Corners"})[cols].copy()
    home["Is_Home"] = 1
    away = matches.rename(columns={
        "Away_Team": "Team", "Home_Team": "Opponent", "Away_Goals": "Goals_For", "Home_Goals": "Goals_Against",
        "Away_Shots": "Shots", "Away_Shots_On_Target": "Shots_On_Target", "Away_Corners": "Corners"})[cols].copy()
    away["Is_Home"] = 0

    tg = pd.concat([home, away]).sort_values(["Team", "Date"]).reset_index(drop=True)
    tg["Points"] = np.select([tg["Goals_For"] > tg["Goals_Against"], tg["Goals_For"] < tg["Goals_Against"]],
                             [3, 0], default=1)
    for s in FORM_STATS:
        tg[f"{s}_Last5"] = tg.groupby("Team")[s].transform(lambda x: x.shift(1).rolling(5).mean())
    return tg


def compute_elo(matches, k=ELO_K, home_adv=ELO_HOME_ADV):
    """Elo ratings, updated after every match.

    Returns (pre_match, history, ratings):
      pre_match: Match_ID, Home_Elo, Away_Elo  -- ratings BEFORE the match (no leakage)
      history:   Date, Team, Elo                -- rating AFTER each match (for "rating as of a date")
      ratings:   dict of the latest rating per team

    New teams start at 1500 in the first season. A team promoted later starts at the average
    of the three lowest-rated teams of the previous season (promoted teams are usually that strength).
    """
    ratings, pre, hist = {}, [], []
    first_season = matches["Season"].min()
    prev_teams, cur_teams, cur_season = set(), set(), first_season
    for r in matches.sort_values("Date").itertuples():
        if r.Season != cur_season:
            prev_teams, cur_teams, cur_season = cur_teams, set(), r.Season
        for t in (r.Home_Team, r.Away_Team):
            if t not in ratings or (t not in prev_teams and t not in cur_teams and r.Season != first_season):
                if r.Season == first_season or not prev_teams:
                    ratings[t] = 1500.0
                else:
                    ratings[t] = float(np.mean(sorted(ratings[x] for x in prev_teams)[:3]))
            cur_teams.add(t)
        rh, ra = ratings[r.Home_Team], ratings[r.Away_Team]
        pre.append((r.Match_ID, rh, ra))
        adv = 0 if r.No_Crowd else home_adv
        expected_h = 1 / (1 + 10 ** (-((rh + adv) - ra) / 400))
        score_h = 1.0 if r.Home_Goals > r.Away_Goals else 0.5 if r.Home_Goals == r.Away_Goals else 0.0
        ratings[r.Home_Team] = rh + k * (score_h - expected_h)
        ratings[r.Away_Team] = ra - k * (score_h - expected_h)
        hist += [(r.Date, r.Home_Team, ratings[r.Home_Team]), (r.Date, r.Away_Team, ratings[r.Away_Team])]
    pre = pd.DataFrame(pre, columns=["Match_ID", "Home_Elo", "Away_Elo"])
    hist = pd.DataFrame(hist, columns=["Date", "Team", "Elo"])
    return pre, hist, ratings


def build_match_table():
    """Matches + last-5 form + Elo. Returns (match_df, team_games, elo_history)."""
    matches = load_matches()
    tg = build_team_games(matches)
    feat = [f"{s}_Last5" for s in FORM_STATS]
    h = tg[tg["Is_Home"] == 1].set_index("Match_ID")[feat].add_prefix("Home_")
    a = tg[tg["Is_Home"] == 0].set_index("Match_ID")[feat].add_prefix("Away_")
    df = matches.set_index("Match_ID").join(h).join(a).reset_index()
    pre, hist, _ = compute_elo(matches)
    df = df.merge(pre, on="Match_ID")
    df["Elo_Diff"] = df["Home_Elo"] - df["Away_Elo"]
    return df, tg, hist


# --------------------------------------------------------------------------------------
# Goal models (Poisson) and score probabilities
# --------------------------------------------------------------------------------------
def _goal_model():
    # the imputer fills the few missing form values (a team's first 5 matches) with the training average
    return make_pipeline(SimpleImputer(), StandardScaler(), PoissonRegressor(alpha=1.0, max_iter=1000))


def fit_goal_models(train):
    """Two Poisson regressions: expected home goals and expected away goals."""
    hm = _goal_model().fit(train[MATCH_FEATURES], train["Home_Goals"])
    am = _goal_model().fit(train[MATCH_FEATURES], train["Away_Goals"])
    return hm, am


def walk_forward_lambdas(match_df):
    """Expected goals (Lam_Home, Lam_Away) for every match from 2017-18 on.

    Each season is predicted by models trained ONLY on earlier seasons, so nothing leaks.
    """
    out = match_df.copy()
    out["Lam_Home"], out["Lam_Away"] = np.nan, np.nan
    for season in PLAYABLE_SEASONS:
        is_s = out["Season"] == season
        hm, am = fit_goal_models(out[out["Season"] < season])
        out.loc[is_s, "Lam_Home"] = hm.predict(out.loc[is_s, MATCH_FEATURES])
        out.loc[is_s, "Lam_Away"] = am.predict(out.loc[is_s, MATCH_FEATURES])
    return out


def _poisson_pmf(lam, max_goals):
    k = np.arange(max_goals + 1)
    return np.exp(-lam) * lam ** k / np.array([math.factorial(int(i)) for i in k])


def score_matrix(lam_h, lam_a, max_goals=10):
    """P(home scores i, away scores j), assuming independent Poisson goals."""
    return np.outer(_poisson_pmf(lam_h, max_goals), _poisson_pmf(lam_a, max_goals))


def outcome_probs(lam_h, lam_a):
    """(P home win, P draw, P away win)."""
    m = score_matrix(lam_h, lam_a)
    return np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()


EXACT_POINTS, RESULT_POINTS = 3, 1


def score_points(pred_h, pred_a, act_h, act_a):
    """3 points for the exact score, 1 for the right result (H/D/A), otherwise 0."""
    if pred_h == act_h and pred_a == act_a:
        return EXACT_POINTS
    return RESULT_POINTS if np.sign(pred_h - pred_a) == np.sign(act_h - act_a) else 0


def best_pick(lam_h, lam_a, max_goals=6):
    """The scoreline with the highest EXPECTED game points (not just the single most likely score)."""
    m = score_matrix(lam_h, lam_a)
    p_res = {1: np.tril(m, -1).sum(), 0: np.trace(m), -1: np.triu(m, 1).sum()}
    best, best_ev = (1, 0), -1.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            p_exact = m[i, j]
            ev = EXACT_POINTS * p_exact + RESULT_POINTS * (p_res[int(np.sign(i - j))] - p_exact)
            if ev > best_ev:
                best, best_ev = (i, j), ev
    return best


# --------------------------------------------------------------------------------------
# FPL per-gameweek player data
# --------------------------------------------------------------------------------------
# FPL team "code" (stable across seasons) -> the team name used in the match CSVs
CODE_TO_TEAM = {
    3: "Arsenal", 7: "Aston Villa", 91: "Bournemouth", 94: "Brentford", 36: "Brighton", 90: "Burnley",
    97: "Cardiff", 8: "Chelsea", 31: "Crystal Palace", 11: "Everton", 54: "Fulham", 38: "Huddersfield",
    88: "Hull", 40: "Ipswich", 2: "Leeds", 13: "Leicester", 14: "Liverpool", 102: "Luton", 43: "Man City",
    1: "Man United", 25: "Middlesbrough", 4: "Newcastle", 45: "Norwich", 17: "Nott'm Forest",
    49: "Sheffield United", 20: "Southampton", 110: "Stoke", 56: "Sunderland", 80: "Swansea",
    6: "Tottenham", 57: "Watford", 35: "West Brom", 21: "West Ham", 39: "Wolves",
}
POSITIONS = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}   # element_type 5 = assistant manager (2024-25), dropped


def _read_csv(path):
    try:
        return pd.read_csv(path)
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding="latin-1")


def load_fpl_season(season):
    """One row per player per fixture, cleaned. Team names match the match CSVs."""
    gw = _read_csv(FPL_DIR / season / "merged_gw.csv")
    raw = _read_csv(FPL_DIR / season / "players_raw.csv")

    team_name = raw.groupby("team")["team_code"].first().map(CODE_TO_TEAM)   # season team id -> name
    if team_name.isna().any():
        raise ValueError(f"{season}: unknown team codes {raw.loc[raw['team'].isin(team_name[team_name.isna()].index), 'team_code'].unique()}")
    raw = raw.set_index("id")

    gw = gw.drop_duplicates()                                   # exact duplicate rows (2025-26)
    gw["Position"] = gw["element"].map(raw["element_type"]).map(POSITIONS)
    gw = gw[gw["Position"].notna()]                             # drops assistant managers
    # a postponed match appears twice (empty row in the old gameweek); keep the row from the later gameweek
    gw = gw.sort_values("GW").drop_duplicates(["element", "fixture"], keep="last")
    gw.loc[gw["GW"] > 38, "GW"] -= 9                            # 2019-20 restart: GW 39-47 -> 30-38
    gw["was_home"] = gw["was_home"].astype(str).str.lower().eq("true")

    # Which teams played in each fixture: home players' opponent is the away team, and vice versa
    away_id = gw[gw["was_home"]].groupby("fixture")["opponent_team"].agg(lambda x: x.mode()[0])
    home_id = gw[~gw["was_home"]].groupby("fixture")["opponent_team"].agg(lambda x: x.mode()[0])
    own_id = np.where(gw["was_home"], gw["fixture"].map(home_id), gw["fixture"].map(away_id))

    first = raw["first_name"].astype(str).str.strip()
    second = raw["second_name"].astype(str).str.strip()
    out = pd.DataFrame({
        "Season": season,
        "GW": gw["GW"].astype(int),
        "Fixture": gw["fixture"],
        "Kickoff": pd.to_datetime(gw["kickoff_time"], utc=True).dt.tz_localize(None),
        "Player_ID": gw["element"].map(raw["code"]),             # "code" is the same player in every season
        "Name": gw["element"].map(first + " " + second),
        "Web_Name": gw["element"].map(raw["web_name"]),
        "Position": gw["Position"],
        "Team": pd.Series(own_id, index=gw.index).map(team_name),
        "Opponent": gw["opponent_team"].map(team_name),
        "Was_Home": gw["was_home"].astype(int),
        "Minutes": gw["minutes"],
        "Goals": gw["goals_scored"],
        "Assists": gw["assists"],
        "Own_Goals": gw["own_goals"],
        "Clean_Sheets": gw["clean_sheets"],
        "Goals_Conceded": gw["goals_conceded"],
        "Saves": gw["saves"],
        "Bonus": gw["bonus"],
        "ICT": gw["ict_index"],
        "Points": gw["total_points"],
        "Price": gw["value"] / 10,
        "Home_Score": gw["team_h_score"],
        "Away_Score": gw["team_a_score"],
    })
    return out.reset_index(drop=True)


def load_fpl(seasons=SEASONS):
    return pd.concat([load_fpl_season(s) for s in seasons], ignore_index=True)


def fpl_fixtures(fpl):
    """One row per fixture: Season, GW, Kickoff, Home_Team, Away_Team, scores."""
    home = fpl[fpl["Was_Home"] == 1].groupby(["Season", "Fixture"]).agg(
        GW=("GW", "first"), Kickoff=("Kickoff", "min"), Home_Team=("Team", "first"),
        Away_Team=("Opponent", "first"), Home_Goals=("Home_Score", "first"), Away_Goals=("Away_Score", "first"))
    return home.reset_index().sort_values(["Season", "Kickoff"]).reset_index(drop=True)


# --------------------------------------------------------------------------------------
# Player gameweek table and the player points model
# --------------------------------------------------------------------------------------
ROLL_STATS = ["Points", "Minutes", "Goals", "Assists", "Bonus", "ICT"]
PLAYER_FEATURES = ([f"{s}_Last5" for s in ROLL_STATS]
                   + ["Points_Season_Avg", "Hist_GWs", "Price", "Pos_Code", "N_Fix", "Was_Home",
                      "Team_Elo", "Opp_Elo", "Lam_For", "Lam_Against", "CS_Prob"])
POS_CODE = {"GK": 1, "DEF": 2, "MID": 3, "FWD": 4}


def add_fixture_context(fpl, match_lam):
    """Attach pre-match Elo and expected goals (for and against) of each player's fixture."""
    ctx = match_lam[["Season", "Home_Team", "Away_Team", "Home_Elo", "Away_Elo", "Lam_Home", "Lam_Away"]]
    df = fpl.copy()
    df["Home_Team"] = np.where(df["Was_Home"] == 1, df["Team"], df["Opponent"])
    df["Away_Team"] = np.where(df["Was_Home"] == 1, df["Opponent"], df["Team"])
    df = df.merge(ctx, on=["Season", "Home_Team", "Away_Team"], how="left")
    home = df["Was_Home"] == 1
    df["Team_Elo"] = np.where(home, df["Home_Elo"], df["Away_Elo"])
    df["Opp_Elo"] = np.where(home, df["Away_Elo"], df["Home_Elo"])
    df["Lam_For"] = np.where(home, df["Lam_Home"], df["Lam_Away"])
    df["Lam_Against"] = np.where(home, df["Lam_Away"], df["Lam_Home"])
    df["CS_Prob"] = np.exp(-df["Lam_Against"])      # Poisson P(conceding 0)
    return df.drop(columns=["Home_Team", "Away_Team", "Home_Elo", "Away_Elo", "Lam_Home", "Lam_Away"])


def build_player_gameweeks(fpl_ctx):
    """One row per player per gameweek (double gameweeks are summed, like FPL scoring).

    Form features use only EARLIER gameweeks (shift(1)), so a gameweek never sees its own result.
    """
    g = fpl_ctx.groupby(["Season", "GW", "Player_ID"], sort=False).agg(
        Name=("Name", "first"), Web_Name=("Web_Name", "first"), Position=("Position", "first"),
        Team=("Team", "last"), Price=("Price", "first"), N_Fix=("Fixture", "count"),
        Minutes=("Minutes", "sum"), Goals=("Goals", "sum"), Assists=("Assists", "sum"),
        Clean_Sheets=("Clean_Sheets", "sum"), Saves=("Saves", "sum"), Bonus=("Bonus", "sum"),
        ICT=("ICT", "sum"), Points=("Points", "sum"), Was_Home=("Was_Home", "mean"),
        Team_Elo=("Team_Elo", "mean"), Opp_Elo=("Opp_Elo", "mean"), Lam_For=("Lam_For", "sum"),
        Lam_Against=("Lam_Against", "sum"), CS_Prob=("CS_Prob", "sum"),
    ).reset_index()
    g["Pos_Code"] = g["Position"].map(POS_CODE)
    g = g.sort_values(["Player_ID", "Season", "GW"]).reset_index(drop=True)

    by_player = g.groupby("Player_ID")
    for s in ROLL_STATS:
        g[f"{s}_Last5"] = by_player[s].transform(lambda x: x.shift(1).rolling(5, min_periods=1).mean())
    g["Hist_GWs"] = by_player.cumcount()
    g["Points_Season_Avg"] = g.groupby(["Player_ID", "Season"])["Points"].transform(
        lambda x: x.shift(1).expanding().mean())
    return g.sort_values(["Season", "GW", "Player_ID"]).reset_index(drop=True)


def fit_player_model(pgw, season):
    """Predict a player's FPL points for a gameweek. Trained only on seasons before `season`."""
    train = pgw[pgw["Season"] < season]
    model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, random_state=0)
    return model.fit(train[PLAYER_FEATURES], train["Points"])


# --------------------------------------------------------------------------------------
# Fantasy squad rules
# --------------------------------------------------------------------------------------
SQUAD_QUOTA = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
XI_LIMITS = {"GK": (1, 1), "DEF": (3, 5), "MID": (2, 5), "FWD": (1, 3)}
BUDGET = 100.0
MAX_PER_CLUB = 3


def _plain(text):
    return unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()


def find_player(pool, query, n=8):
    """Search players in `pool` by (part of) their name; accents and case are ignored."""
    q = _plain(query)
    names = pool["Name"].map(_plain) + " | " + pool["Web_Name"].map(_plain)
    hits = pool[names.str.contains(q, regex=False)]
    if hits.empty:
        close = difflib.get_close_matches(q, pool["Web_Name"].map(_plain).tolist(), n=n, cutoff=0.6)
        hits = pool[pool["Web_Name"].map(_plain).isin(close)]
    cols = [c for c in ["Name", "Web_Name", "Position", "Team", "Price", "Pred"] if c in pool]
    return hits[cols].head(n)


def resolve_players(pool, names):
    """Turn a list of names into Player_IDs, with a clear error for unknown or ambiguous names."""
    ids, problems = [], []
    for name in names:
        hits = find_player(pool, name, n=50)
        exact = hits[(hits["Name"].map(_plain) == _plain(name)) | (hits["Web_Name"].map(_plain) == _plain(name))]
        hits = exact if len(exact) >= 1 else hits
        if len(hits) == 1:
            ids.append(pool.loc[hits.index[0], "Player_ID"])
        elif hits.empty:
            problems.append(f"'{name}': no player found (they may not have a fixture this gameweek)")
        else:
            options = ", ".join(f"{r.Name} ({r.Team})" for r in hits.head(5).itertuples())
            problems.append(f"'{name}' matches several players: {options} -- use the full name")
    if problems:
        raise ValueError("\n".join(problems))
    return ids


def validate_squad(pool, squad_ids, xi_ids, captain_id):
    """Return a list of rule problems (empty list = valid team)."""
    errors = []
    sq = pool[pool["Player_ID"].isin(squad_ids)].drop_duplicates("Player_ID")
    if len(set(squad_ids)) != 15:
        errors.append(f"squad must have 15 different players (has {len(set(squad_ids))})")
    for pos, n in SQUAD_QUOTA.items():
        if (sq["Position"] == pos).sum() != n:
            errors.append(f"squad needs exactly {n} {pos} (has {(sq['Position'] == pos).sum()})")
    cost = sq["Price"].sum()
    if cost > BUDGET + 1e-9:
        errors.append(f"squad costs £{cost:.1f}m, budget is £{BUDGET:.0f}m")
    for club, n in sq["Team"].value_counts().items():
        if n > MAX_PER_CLUB:
            errors.append(f"{n} players from {club} (max {MAX_PER_CLUB})")
    if len(set(xi_ids)) != 11 or not set(xi_ids) <= set(squad_ids):
        errors.append("starting XI must be 11 different players from the squad")
    xi = sq[sq["Player_ID"].isin(xi_ids)]
    for pos, (lo, hi) in XI_LIMITS.items():
        n = (xi["Position"] == pos).sum()
        if not lo <= n <= hi:
            errors.append(f"XI needs {lo}-{hi} {pos} (has {n})")
    if captain_id not in set(xi_ids):
        errors.append("captain must be in the starting XI")
    return errors


def best_xi(squad, col="Pred"):
    """Highest-`col` valid starting XI from a 15-player squad. Returns (xi_ids, captain_id)."""
    sq = squad.sort_values(col, ascending=False)
    picked = []
    for pos, (lo, _) in XI_LIMITS.items():               # minimum per position first
        picked += sq[sq["Position"] == pos].head(lo)["Player_ID"].tolist()
    counts = {pos: lo for pos, (lo, _) in XI_LIMITS.items()}
    for r in sq.itertuples():                             # then the best of the rest
        if len(picked) == 11:
            break
        if r.Player_ID not in picked and counts[r.Position] < XI_LIMITS[r.Position][1]:
            picked.append(r.Player_ID)
            counts[r.Position] += 1
    captain = sq[sq["Player_ID"].isin(picked)].iloc[0]["Player_ID"]
    return picked, captain


FORMATIONS = [(d, m, f) for d in range(3, 6) for m in range(2, 6) for f in range(1, 4) if d + m + f == 10]


def _greedy_xi(pool, formation, budget, col):
    """Best predicted starters for one formation, always keeping enough money for the open slots."""
    need = {"GK": 1, "DEF": formation[0], "MID": formation[1], "FWD": formation[2]}
    cheapest = pool.groupby("Position")["Price"].apply(lambda p: sorted(p))
    reserve = lambda nd: sum(sum(cheapest[pos][:n]) for pos, n in nd.items())
    xi, clubs, spent = [], {}, 0.0
    for r in pool.itertuples():
        if need[r.Position] == 0 or clubs.get(r.Team, 0) >= MAX_PER_CLUB:
            continue
        need_after = {**need, r.Position: need[r.Position] - 1}
        if spent + r.Price + reserve(need_after) > budget + 1e-9:
            continue
        xi.append(r)
        spent, need = spent + r.Price, need_after
        clubs[r.Team] = clubs.get(r.Team, 0) + 1
    # upgrade pass: use leftover money to swap weak starters for better ones in the same position
    taken = {r.Player_ID for r in xi}
    for i in sorted(range(len(xi)), key=lambda i: getattr(xi[i], col)):
        old = xi[i]
        money = budget - spent + old.Price
        clubs[old.Team] -= 1
        for r in pool.itertuples():   # pool is sorted best first, so the first fit is the best upgrade
            if getattr(r, col) <= getattr(old, col):
                break
            if (r.Position == old.Position and r.Player_ID not in taken and r.Price <= money + 1e-9
                    and clubs.get(r.Team, 0) < MAX_PER_CLUB):
                taken.discard(old.Player_ID)
                taken.add(r.Player_ID)
                spent += r.Price - old.Price
                xi[i] = old = r
                break
        clubs[old.Team] = clubs.get(old.Team, 0) + 1
    return xi, clubs, spent


def machine_squad(pool, col="Pred"):
    """The machine's 15-man squad.

    For every formation: pick the starting XI greedily by predicted points while keeping money
    for the cheapest possible bench, then fill the bench with the cheapest players.
    The formation whose XI (plus captain bonus) has the highest predicted total wins.
    """
    pool = pool.drop_duplicates("Player_ID").sort_values(col, ascending=False)
    best, best_score = None, -np.inf
    for formation in FORMATIONS:
        bench_need = {"GK": 1, "DEF": 5 - formation[0], "MID": 5 - formation[1], "FWD": 3 - formation[2]}
        by_price = pool.sort_values("Price")
        bench_cost = sum(by_price[by_price["Position"] == p]["Price"].head(n).sum() for p, n in bench_need.items())
        xi, clubs, spent = _greedy_xi(pool, formation, BUDGET - bench_cost, col)
        if len(xi) < 11:
            continue
        squad = [r.Player_ID for r in xi]
        for r in by_price.itertuples():                       # cheapest bench that respects the club limit
            if bench_need[r.Position] > 0 and r.Player_ID not in squad and clubs.get(r.Team, 0) < MAX_PER_CLUB:
                squad.append(r.Player_ID)
                bench_need[r.Position] -= 1
                clubs[r.Team] = clubs.get(r.Team, 0) + 1
                spent += r.Price
        if len(squad) != 15 or spent > BUDGET + 1e-9:
            continue
        preds = [getattr(r, col) for r in xi]
        score = sum(preds) + max(preds)
        if score > best_score:
            best, best_score = squad, score
    return best


def team_points(gw_rows, xi_ids, captain_id):
    """FPL points of a starting XI in a gameweek (captain doubled; no auto-substitutions)."""
    pts = gw_rows.drop_duplicates("Player_ID").set_index("Player_ID")["Points"]
    return int(sum(pts.get(p, 0) for p in xi_ids) + pts.get(captain_id, 0))


# --------------------------------------------------------------------------------------
# Season projections for the awards
# --------------------------------------------------------------------------------------
def team_state(team_games, elo_hist, as_of):
    """Each team's last-5 form and Elo using only matches played before `as_of`."""
    tg = team_games[team_games["Date"] < as_of].sort_values("Date")
    form = tg.groupby("Team")[FORM_STATS].apply(lambda x: x.tail(5).mean())
    elo = elo_hist[elo_hist["Date"] < as_of].groupby("Team")["Elo"].last()
    return form, elo


def frozen_lambdas(fixtures, goal_models, form, elo):
    """Expected goals for future fixtures, using team form/Elo frozen at one date (no future info)."""
    hm, am = goal_models
    rows = []
    for f in fixtures.itertuples():
        row = {}
        for side, team in (("Home", f.Home_Team), ("Away", f.Away_Team)):
            for s in FORM_STATS:
                row[f"{side}_{s}_Last5"] = form.loc[team, s] if team in form.index else np.nan
            row[f"{side}_Elo"] = elo.get(team, 1500.0)
        row["Elo_Diff"] = row["Home_Elo"] - row["Away_Elo"]
        row["No_Crowd"] = int(getattr(f, "No_Crowd", 0))
        rows.append(row)
    X = pd.DataFrame(rows)[MATCH_FEATURES]
    out = fixtures.copy()
    out["Lam_Home"], out["Lam_Away"] = hm.predict(X), am.predict(X)
    return out


AWARDS = ["Player of the Season", "Golden Boot", "Playmaker", "Golden Glove"]


def season_winners(pgw, season):
    """Real winners (ties all count). Defined from FPL data: most points / goals / assists / GK clean sheets."""
    s = pgw[pgw["Season"] == season]
    tot = s.groupby(["Player_ID", "Name", "Position"])[["Points", "Goals", "Assists", "Clean_Sheets"]].sum().reset_index()
    gk = tot[tot["Position"] == "GK"]
    pick = lambda d, c: set(d.loc[d[c] == d[c].max(), "Name"])
    return {"Player of the Season": pick(tot, "Points"), "Golden Boot": pick(tot, "Goals"),
            "Playmaker": pick(tot, "Assists"), "Golden Glove": pick(gk, "Clean_Sheets")}


def award_projections(pgw, fixtures, team_games, elo_hist, goal_models, season, after_gw):
    """Projected end-of-season totals, using only gameweeks 1..after_gw of `season`.

    projected = so far + (rate per team match so far) x (strength of the remaining fixtures)
    """
    fx = fixtures[fixtures["Season"] == season]
    played_fx, future_fx = fx[fx["GW"] <= after_gw], fx[fx["GW"] > after_gw]
    as_of = future_fx["Kickoff"].min() if len(future_fx) else fx["Kickoff"].max() + pd.Timedelta(days=1)
    form, elo = team_state(team_games, elo_hist, as_of.normalize())
    fut = frozen_lambdas(future_fx, goal_models, form, elo) if len(future_fx) else future_fx.assign(Lam_Home=[], Lam_Away=[])

    team_rows = pd.concat([
        pd.DataFrame({"Team": fut["Home_Team"], "Lam_For": fut["Lam_Home"], "Lam_Against": fut["Lam_Away"]}),
        pd.DataFrame({"Team": fut["Away_Team"], "Lam_For": fut["Lam_Away"], "Lam_Against": fut["Lam_Home"]})])
    avg_lam = team_rows["Lam_For"].mean() if len(team_rows) else 1.0
    remaining = team_rows.groupby("Team").agg(
        Fix_Left=("Lam_For", "size"),
        Attack_Left=("Lam_For", lambda x: (x / avg_lam).sum()),     # remaining fixtures weighted by expected goals
        CS_Left=("Lam_Against", lambda x: np.exp(-x).sum()))        # expected clean sheets left
    played = pd.concat([played_fx["Home_Team"], played_fx["Away_Team"]]).value_counts().rename("Team_Played")

    s = pgw[(pgw["Season"] == season) & (pgw["GW"] <= after_gw)]
    tot = s.groupby("Player_ID").agg(Name=("Name", "last"), Position=("Position", "last"), Team=("Team", "last"),
                                     Points=("Points", "sum"), Goals=("Goals", "sum"), Assists=("Assists", "sum"),
                                     Clean_Sheets=("Clean_Sheets", "sum"), Minutes=("Minutes", "sum")).reset_index()
    tot = tot.join(played, on="Team").join(remaining, on="Team")
    tot[["Fix_Left", "Attack_Left", "CS_Left"]] = tot[["Fix_Left", "Attack_Left", "CS_Left"]].fillna(0)
    n = tot["Team_Played"].clip(lower=1)
    tot["Proj_Points"] = tot["Points"] + tot["Points"] / n * tot["Fix_Left"]
    tot["Proj_Goals"] = tot["Goals"] + tot["Goals"] / n * tot["Attack_Left"]
    tot["Proj_Assists"] = tot["Assists"] + tot["Assists"] / n * tot["Attack_Left"]
    share = (tot["Minutes"] / (90 * n)).clip(upper=1)                 # how often the keeper plays
    tot["Proj_Clean_Sheets"] = np.where(tot["Position"] == "GK", tot["Clean_Sheets"] + share * tot["CS_Left"], np.nan)
    return tot


def machine_award_picks(proj):
    top = lambda c: proj.sort_values(c, ascending=False).iloc[0]["Name"]
    return {"Player of the Season": top("Proj_Points"), "Golden Boot": top("Proj_Goals"),
            "Playmaker": top("Proj_Assists"), "Golden Glove": top("Proj_Clean_Sheets")}


# --------------------------------------------------------------------------------------
# Saving game results
# --------------------------------------------------------------------------------------
def save_results(df, filename, keys):
    """Append rows to game/<filename>; replaying the same gameweek replaces the old rows."""
    GAME_DIR.mkdir(exist_ok=True)
    path = GAME_DIR / filename
    if path.exists():
        df = pd.concat([pd.read_csv(path), df], ignore_index=True)
    df = df.drop_duplicates(keys, keep="last")
    df.to_csv(path, index=False)
    return df
