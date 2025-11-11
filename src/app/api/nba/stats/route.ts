// Next.js (app router) API route: /api/nba/stats?date=YYYY-MM-DD (optional)
// Produces { stats: { [playerId]: box }, points: { [playerId]: fp } }
// using ESPN summary/boxscore per event on the date.
import { NextResponse } from "next/server";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const SUMMARY = (eventId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;

function yyyymmdd(input?: string) {
  if (input && /^\d{8}$/.test(input)) return input;
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input.replaceAll("-", "");
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, next: { revalidate: 30 } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

// Very simple fantasy formula (tweak as you like)
// Pts + 1.2*Reb + 1.5*Ast + 3*Stl + 3*Blk - 1*TOV + 0.5*3PM
function fpts(s: any) {
  const n = (x: any) => (typeof x === "number" ? x : Number(x || 0));
  return (
    n(s.points) +
    1.2 * n(s.totReb ?? s.rebounds) +
    1.5 * n(s.assists) +
    3 * n(s.steals) +
    3 * n(s.blocks) -
    1 * n(s.turnovers) +
    0.5 * n(s.threePointFieldGoalsMade ?? s.threePointersMade ?? s.fg3m)
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date") || undefined;
    const compact = yyyymmdd(dateParam);

    const sb = await j<any>(`${SCOREBOARD}?dates=${compact}`);
    const events: any[] = sb?.events ?? [];
    if (!events.length) {
      return NextResponse.json({ stats: {}, points: {} }, { status: 200 });
    }

    const stats: Record<string, any> = {};
    const points: Record<string, number> = {};

    // Pull each event's summary and walk the boxscore players
    await Promise.all(
      events.map(async (ev) => {
        try {
          const evId = String(ev?.id ?? ev?.uid ?? "");
          if (!evId) return;
          const sum = await j<any>(SUMMARY(evId));

          // Boxscore shape varies; ESPN exposes "boxscore" -> "players" grouped by team
          const box = sum?.boxscore?.players ?? [];
          for (const teamBlock of box) {
            for (const at of teamBlock?.statistics ?? []) {
              // Some variants use teamBlock.athletes
            }
            for (const athlete of teamBlock?.athletes ?? []) {
              const a = athlete?.athlete;
              if (!a?.id) continue;
              const id = `nba:${a.id}`;

              // Merge stat lines across sections, normalizing keys
              const line: any = {
                pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fg3m: 0, min: 0,
              };

              // ESPN presents stats as arrays of {name, value}
              for (const sect of athlete?.stats ?? []) {
                for (const s of sect?.stats ?? []) {
                  const name = (s?.name || "").toLowerCase();
                  const val = Number(s?.value ?? 0);
                  if (name === "points" || name === "pts") line.pts = val;
                  if (name === "totreb" || name === "rebounds" || name === "reb") line.reb = val;
                  if (name === "assists" || name === "ast") line.ast = val;
                  if (name === "steals" || name === "stl") line.stl = val;
                  if (name === "blocks" || name === "blk") line.blk = val;
                  if (name === "turnovers" || name === "to" || name === "tov") line.tov = val;
                  if (name === "threepointersmade" || name === "3ptm" || name === "fg3m") line.fg3m = val;
                  if (name === "minutes" || name === "min") line.min = val;
                }
              }

              stats[id] = line;
              points[id] = fpts({
                points: line.pts,
                totReb: line.reb,
                assists: line.ast,
                steals: line.stl,
                blocks: line.blk,
                turnovers: line.tov,
                threePointFieldGoalsMade: line.fg3m,
              });
            }
          }
        } catch {
          // ignore event failures; continue
        }
      })
    );

    return NextResponse.json({ stats, points }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
