"""Export the machine's predictions as JSON for the React app (web/).

Every playable season is already finished, so the machine's picks never change: we compute them once here
with the same models as notebooks 04-06, and the website just reads the files.

Files ending in ".reveal.json" contain results/points and are only downloaded when you press Reveal.
All other files are checked to contain NO results.

Run from the project folder:   python scripts/export_web_data.py
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import pl  # noqa: E402

OUT = ROOT / "web" / "public" / "data"

# 3-letter codes and a primary colour per club (simple coloured badges, no club logos)
CLUBS = {
    "Arsenal": ("ARS", "#EF0107"), "Aston Villa": ("AVL", "#670E36"), "Bournemouth": ("BOU", "#DA291C"),
    "Brentford": ("BRE", "#E30613"), "Brighton": ("BHA", "#0057B8"), "Burnley": ("BUR", "#6C1D45"),
    "Cardiff": ("CAR", "#0070B5"), "Chelsea": ("CHE", "#034694"), "Crystal Palace": ("CRY", "#1B458F"),
    "Everton": ("EVE", "#003399"), "Fulham": ("FUL", "#CCCCCC"), "Huddersfield": ("HUD", "#0E63AD"),
    "Hull": ("HUL", "#F5A12D"), "Ipswich": ("IPS", "#3A64A3"), "Leeds": ("LEE", "#FFCD00"),
    "Leicester": ("LEI", "#003090"), "Liverpool": ("LIV", "#C8102E"), "Luton": ("LUT", "#F78F1E"),
    "Man City": ("MCI", "#6CABDD"), "Man United": ("MUN", "#DA291C"), "Middlesbrough": ("MID", "#E11B22"),
    "Newcastle": ("NEW", "#241F20"), "Norwich": ("NOR", "#00A650"), "Nott'm Forest": ("NFO", "#DD0000"),
    "Sheffield United": ("SHU", "#EE2737"), "Southampton": ("SOU", "#D71920"), "Stoke": ("STK", "#E03A3E"),
    "Sunderland": ("SUN", "#EB172B"), "Swansea": ("SWA", "#121212"), "Tottenham": ("TOT", "#132257"),
    "Watford": ("WAT", "#FBEE23"), "West Brom": ("WBA", "#122F67"), "West Ham": ("WHU", "#7A263A"),
    "Wolves": ("WOL", "#FDB913"),
}
# per-match stats exported for the points breakdown (web/src/lib/rules.js pointsBreakdown reads these keys)
STAT_COLS = ["Minutes", "Goals", "Assists", "Clean_Sheets", "Goals_Conceded", "Own_Goals", "Pen_Saved",
             "Pen_Missed", "Yellow_Cards", "Red_Cards", "Saves", "Bonus", "Def_Contrib", "Points"]
STAT_KEYS = ["min", "g", "a", "cs", "gc", "og", "ps", "pm", "yc", "rc", "sv", "bonus", "dc", "pts"]
RESULT_WORDS = ("result", "points", "goals", "winner", "assists", "clean")   # must not appear in pre-reveal files


def write(rel, obj, reveal=False):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    if not reveal:
        keys = text.lower()
        bad = [w for w in RESULT_WORDS if f'"{w}' in keys]
        assert not bad, f"{rel} would leak results: {bad}"
    path.write_text(text, encoding="utf-8")


def r1(x):
    return None if pd.isna(x) else round(float(x), 1)


def main():
    t0 = time.time()
    print("loading data and features ...")
    mdf, tg, eh = pl.build_match_table()
    lam = pl.walk_forward_lambdas(mdf)
    fpl = pl.load_fpl()
    fixtures = pl.fpl_fixtures(fpl).merge(mdf[["Season", "Home_Team", "Away_Team", "No_Crowd"]],
                                          on=["Season", "Home_Team", "Away_Team"])
    pgw = pl.build_player_gameweeks(pl.add_fixture_context(fpl, lam))
    print(f"  done in {time.time() - t0:.0f}s")

    unknown = set(fixtures["Home_Team"]) - set(CLUBS)
    assert not unknown, f"add these clubs to CLUBS: {unknown}"

    # (the game rules live in web/src/lib/rules.js; rules.test.js checks them against Python)
    index = {"seasons": [], "clubs": {name: {"code": c, "color": col} for name, (c, col) in CLUBS.items()}}

    for season in pl.PLAYABLE_SEASONS:
        ts = time.time()
        fx = fixtures[fixtures["Season"] == season]
        gws = sorted(fx["GW"].unique().tolist())
        index["seasons"].append({"season": season, "gameweeks": gws})

        # ---------- score predictor
        lm = lam[lam["Season"] == season].set_index(["Home_Team", "Away_Team"])
        for gw in gws:
            g = fx[fx["GW"] == gw].sort_values("Kickoff")
            pre, rev = [], {}
            for f in g.itertuples():
                lh, la = lm.loc[(f.Home_Team, f.Away_Team), ["Lam_Home", "Lam_Away"]]
                mh, ma = pl.best_pick(lh, la)
                ph, pd_, pa = pl.outcome_probs(lh, la)
                pre.append({"id": int(f.Fixture), "home": f.Home_Team, "away": f.Away_Team,
                            "kickoff": f.Kickoff.isoformat()})
                rev[int(f.Fixture)] = {"machine": [mh, ma], "probs": [round(ph, 3), round(pd_, 3), round(pa, 3)],
                                       "xg": [round(lh, 2), round(la, 2)],
                                       "result": [int(f.Home_Goals), int(f.Away_Goals)]}
            write(f"{season}/score/{gw}.json", {"season": season, "gw": gw, "fixtures": pre})
            write(f"{season}/score/{gw}.reveal.json", rev, reveal=True)

        # ---------- fantasy (+ player of the week)
        model = pl.fit_player_model(pgw, season)
        s_rows = pgw[pgw["Season"] == season].copy()
        s_rows["Pred"] = model.predict(s_rows[pl.PLAYER_FEATURES])
        players = s_rows.drop_duplicates("Player_ID", keep="last").set_index("Player_ID")
        fpl_s = fpl[fpl["Season"] == season]
        write(f"{season}/players.json",
              {int(i): [r.Name, r.Web_Name] for i, r in players[["Name", "Web_Name"]].iterrows()})
        for gw in gws:
            playing = s_rows[s_rows["GW"] == gw]
            # Players whose team has no match this gameweek can still be picked (they score 0), like in real FPL.
            # Without them a "blank" gameweek with few matches can't fill 15 places under the 3-per-club rule.
            idle = s_rows[(s_rows["GW"] < gw) & ~s_rows["Player_ID"].isin(playing["Player_ID"])]
            idle = idle.drop_duplicates("Player_ID", keep="last").assign(N_Fix=0, Pred=0.0, Points=0)
            pool = pd.concat([playing, idle], ignore_index=True)
            # columns: id, position, club, price, form (last-5 avg points), fixtures this GW
            rows = [[int(r.Player_ID), r.Position, r.Team, float(r.Price), r1(r.Points_Last5), int(r.N_Fix)]
                    for r in pool.itertuples()]
            write(f"{season}/fantasy/{gw}.json", {"season": season, "gw": gw,
                                                  "cols": ["id", "pos", "club", "price", "form", "nfix"], "rows": rows})
            squad = pl.machine_squad(pool)
            assert squad is not None, f"{season} GW {gw}: no valid machine squad"
            xi, cap = pl.best_xi(pool[pool["Player_ID"].isin(squad)])
            assert not pl.validate_squad(pool, squad, xi, cap)
            top = pool["Points"].max()
            potw_pick = pool.sort_values("Pred", ascending=False).iloc[0]
            # per-match stats so the site can explain each player's points (only players who played or scored)
            m = fpl_s[(fpl_s["GW"] == gw) & ((fpl_s["Minutes"] > 0) | (fpl_s["Points"] != 0))]
            stats = {}
            for r in m.itertuples():
                own, opp = (r.Home_Score, r.Away_Score) if r.Was_Home else (r.Away_Score, r.Home_Score)
                stats.setdefault(int(r.Player_ID), []).append(
                    [r.Opponent, int(r.Was_Home), int(own), int(opp)] + [int(getattr(r, c)) for c in STAT_COLS])
            write(f"{season}/fantasy/{gw}.reveal.json", {
                "points": {int(r.Player_ID): int(r.Points) for r in pool.itertuples()},
                "machine": {"squad": [int(p) for p in squad], "xi": [int(p) for p in xi], "captain": int(cap),
                            "total": pl.team_points(pool, xi, cap)},
                "topScorers": [int(p) for p in pool.loc[pool["Points"] == top, "Player_ID"]],
                "topPoints": int(top),
                "machinePotw": int(potw_pick["Player_ID"]),
                "statCols": ["opp", "home", "for", "against"] + STAT_KEYS,
                "stats": stats,
            }, reveal=True)

        # ---------- awards
        gm = pl.fit_goal_models(mdf[mdf["Season"] < season])
        win = pl.season_winners(pgw, season)
        name_to_ids = s_rows.groupby("Name")["Player_ID"].unique()
        write(f"{season}/awards/winners.json",
              {a: sorted(int(i) for n in names for i in name_to_ids[n]) for a, names in win.items()}, reveal=True)
        last_gw = gws[-1]
        for after in gws[:-1]:
            so_far = s_rows[s_rows["GW"] <= after].groupby("Player_ID").agg(
                pos=("Position", "last"), club=("Team", "last"), pts=("Points", "sum"), g=("Goals", "sum"),
                a=("Assists", "sum"), cs=("Clean_Sheets", "sum"), mins=("Minutes", "sum"))
            so_far = so_far[so_far["mins"] > 0]
            # stats so far are allowed (they happened before the prediction); columns are abbreviated on purpose
            write(f"{season}/awards/{after}.json", {
                "season": season, "afterGw": after, "lastGw": last_gw,
                "cols": ["id", "pos", "club", "pts", "g", "a", "cs", "mins"],
                "rows": [[int(i), r.pos, r.club, int(r.pts), int(r.g), int(r.a), int(r.cs), int(r.mins)]
                         for i, r in so_far.iterrows()]})
            proj = pl.award_projections(pgw, fixtures, tg, eh, gm, season, after)
            picks = pl.machine_award_picks(proj)
            id_of = dict(zip(proj["Name"], proj["Player_ID"]))
            top5 = {}
            for award, col in [("Player of the Season", "Proj_Points"), ("Golden Boot", "Proj_Goals"),
                               ("Playmaker", "Proj_Assists"), ("Golden Glove", "Proj_Clean_Sheets")]:
                t = proj.sort_values(col, ascending=False).head(5)
                top5[award] = [[int(r.Player_ID), round(float(getattr(r, col)), 1)] for r in t.itertuples()]
            write(f"{season}/awards/{after}.reveal.json",
                  {"machine": {a: int(id_of[n]) for a, n in picks.items()}, "projections": top5}, reveal=True)
        print(f"{season}: {len(gws)} gameweeks exported in {time.time() - ts:.0f}s")

    write("index.json", index)

    # ---------- test cases so the JavaScript rules can be checked against Python
    score_cases = [[ph, pa, ah, aa, pl.score_points(ph, pa, ah, aa)]
                   for ph in range(4) for pa in range(4) for ah in range(4) for aa in range(4)]
    season, gw = "2025-26", 1
    pool = pgw[(pgw["Season"] == season) & (pgw["GW"] == gw)].copy()
    pool["Pred"] = pl.fit_player_model(pgw, season).predict(pool[pl.PLAYER_FEATURES])
    squad = [int(p) for p in pl.machine_squad(pool)]
    xi, cap = pl.best_xi(pool[pool["Player_ID"].isin(squad)])
    xi, cap = [int(p) for p in xi], int(cap)
    bench = [p for p in squad if p not in xi]
    by_pos = pool.drop_duplicates("Player_ID").set_index("Player_ID")
    extra_mid = int(by_pos[(by_pos["Position"] == "MID") & ~by_pos.index.isin(squad)].sort_values("Price").index[0])
    most_exp = int(by_pos[by_pos["Position"] == "FWD"].sort_values("Price").index[-1])
    first_fwd = [p for p in squad if by_pos.loc[p, "Position"] == "FWD"][0]
    swapped = [most_exp if p == first_fwd else p for p in squad]
    cases = {
        "valid machine squad": (squad, xi, cap),
        "16 players": (squad + [extra_mid], xi, cap),
        "captain on bench": (squad, xi, bench[0]),
        "only 10 starters": (squad, xi[:10], cap),
        "most expensive forward swapped in": (swapped, [most_exp if p == first_fwd else p for p in xi], cap),
    }
    squad_cases = [{"name": n, "squad": s, "xi": x, "captain": c,
                    "valid": not pl.validate_squad(pool, s, x, c),
                    "points": pl.team_points(pool, x, c)} for n, (s, x, c) in cases.items()]
    write("test_cases.json", {"season": season, "gw": gw, "score": score_cases, "squads": squad_cases}, reveal=True)

    total = sum(f.stat().st_size for f in OUT.rglob("*.json"))
    print(f"wrote {sum(1 for _ in OUT.rglob('*.json'))} files, {total / 1e6:.1f} MB, in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
