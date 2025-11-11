// Next.js (App Router) API route: /api/nba/stats?date=YYYY-MM-DD
import { NextResponse, NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const r = await fetch(url, {
    headers: { "User-Agent": "fantasy-hundred/1.0" },
    cache: "no-store",
    next: { revalidate: 0 },
    ...init,
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

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

export async function GET(req: NextRequest) {
  try {
    const dateParam = req.nextUrl.searchParams.get("date") || undefined;
    const compact = yyyymmdd(dateParam);

    const sb = await j<any>(`${SCOREBOARD}?dates=${compact}`);
    const events: any[] = sb?.events ?? [];
    if (!events.length) {
      return NextResponse.json({
        stats: {},
        points: {},
        meta: { usedDate: dateParam ?? "today", events: 0, eventsProcessed: 0, sampleErrors: [] },
      });
    }

    const stats: Record<string, any> = {};
    const points: Record<string, number> = {};
    let eventsProcessed = 0;
    const sampleErrors: Array<{ eventId: string; err: string }> = [];

    await Promise.all(
      events.map(async (ev) => {
        const evId = String(ev?.id ?? ev?.uid ?? "");
        if (!evId) return;
        try {
          const sum = await j<any>(SUMMARY(evId));
          const teams = sum?.boxscore?.players ?? [];
          for (const teamBlock of teams) {
            for (const athlete of teamBlock?.athletes ?? []) {
              const a = athlete?.athlete;
              if (!a?.id) continue;
              const id = `nba:${a.id}`;
              const line: any = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fg3m: 0, min: 0 };

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
          eventsProcessed++;
        } catch (e: any) {
          if (sampleErrors.length < 4) sampleErrors.push({ eventId: evId, err: String(e?.message || e) });
        }
      })
    );

    return NextResponse.json({
      stats,
      points,
      meta: { usedDate: dateParam ?? "today", events: events.length, eventsProcessed, sampleErrors },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
