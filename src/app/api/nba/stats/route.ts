import { NextResponse } from "next/server";

function toYYYYMMDD(dateStr?: string) {
  const d = dateStr ? new Date(dateStr + "T12:00:00-05:00") : new Date();
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  return ny.replaceAll("-", "");
}

function scoreNBA(s: any) {
  // Simple fantasy scoring to match your UI:
  // pts + 1.2*reb + 1.5*ast + 3*stl + 3*blk - tov + 0.5*3pm
  const pts = Number(s.points ?? s.pts ?? 0);
  const reb = Number(s.rebounds ?? s.reb ?? 0);
  const ast = Number(s.assists ?? s.ast ?? 0);
  const stl = Number(s.steals ?? s.stl ?? 0);
  const blk = Number(s.blocks ?? s.blk ?? 0);
  const tov = Number(s.turnovers ?? s.tov ?? 0);
  const fg3m = Number(s.threePointersMade ?? s.fg3m ?? s.threePointFieldGoalsMade ?? 0);
  return pts + 1.2 * reb + 1.5 * ast + 3 * stl + 3 * blk - tov + 0.5 * fg3m;
}

export const revalidate = 30; // cache 30s

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date") || undefined;
    const yyyymmdd = toYYYYMMDD(dateParam);

    // 1) Get the day’s events
    const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;
    const sbRes = await fetch(sbUrl, { cache: "no-store" });
    if (!sbRes.ok) {
      return NextResponse.json({ error: `scoreboard ${sbRes.status}` }, { status: sbRes.status });
    }
    const sb = await sbRes.json();
    const events: any[] = sb?.events ?? [];
    if (!events.length) return NextResponse.json({ stats: {}, points: {} }, { status: 200 });

    // 2) For each event, pull the boxscore/summary and collect player lines
    const stats: Record<string, any> = {};
    const points: Record<string, number> = {};

    const pulls = events.map(async (ev) => {
      const eventId = ev?.id;
      if (!eventId) return;

      // ESPN “summary” has boxscore players with counting stats
      const sumUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
      const sRes = await fetch(sumUrl, { cache: "no-store" });
      if (!sRes.ok) return;
      const sum = await sRes.json();

      const boxTeams =
        sum?.boxscore?.players ??
        sum?.boxscore?.teams ?? // older variants
        [];

      for (const side of boxTeams) {
        const plist =
          side?.statistics?.players ?? // variant
          side?.players ?? // variant
          side?.athletes ?? // variant
          [];

        for (const p of plist) {
          const pid = String(p?.athlete?.id ?? p?.id ?? "");
          if (!pid) continue;

          // Normalize common fields
          const line = {
            min: p?.stats?.minutes ?? p?.minutes ?? 0,
            pts: Number(p?.stats?.points ?? p?.points ?? 0),
            reb: Number(p?.stats?.rebounds ?? p?.rebounds ?? 0),
            ast: Number(p?.stats?.assists ?? p?.assists ?? 0),
            stl: Number(p?.stats?.steals ?? p?.steals ?? 0),
            blk: Number(p?.stats?.blocks ?? p?.blocks ?? 0),
            tov: Number(p?.stats?.turnovers ?? p?.turnovers ?? 0),
            fg3m: Number(
              p?.stats?.threePointFieldGoalsMade ??
              p?.threePointFieldGoalsMade ??
              p?.stats?.threePointersMade ??
              p?.fg3m ??
              0
            ),
          };

          stats[pid] = line;
          points[pid] = scoreNBA(line);
        }
      }
    });

    await Promise.all(pulls);

    return NextResponse.json({ stats, points }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
