import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const revalidate = 0;
export const dynamic = "force-dynamic";

function toYYYYMMDD(dateISO: string) {
  return dateISO.replace(/-/g, "");
}

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

// DK-like fantasy formula
function fp(row: any) {
  return (
    (row.points ?? 0) +
    1.2 * (row.reboundsTotal ?? 0) +
    1.5 * (row.assists ?? 0) +
    3   * (row.steals ?? 0) +
    3   * (row.blocks ?? 0) -
    1   * (row.turnovers ?? 0)
  );
}

type Totals = {
  pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg3m: number; min: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const ymd = toYYYYMMDD(date);

    // 1) Get the day’s events
    const scoreboard = await fetchJSON<any>(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=${ymd}`);
    const events: any[] = scoreboard?.events ?? [];
    if (events.length === 0) {
      return NextResponse.json({ date, count: 0, points: {}, stats: {} }, { status: 200 });
    }

    // 2) For each event, load the summary (box scores live here)
    const eventIds = events.map((e) => String(e?.id)).filter(Boolean);
    const summaries = await Promise.all(
      eventIds.map((id) =>
        fetchJSON<any>(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/summary?event=${encodeURIComponent(id)}`)
          .catch(() => null)
      )
    );

    const points = new Map<string, number>();
    const stats  = new Map<string, Totals>();

    for (const sum of summaries) {
      if (!sum?.boxscore?.players) continue;
      const teams = sum.boxscore.players as any[];

      // teams[] ~ [{ team: {...}, statistics: [...], players: [{ athlete, statistics: [...] }]}]
      for (const t of teams) {
        const athletes = t?.players ?? t?.athletes ?? [];
        for (const a of athletes) {
          const ath = a?.athlete ?? a?.athleteId ?? a;
          const id = String(ath?.id ?? a?.id ?? "");
          if (!id) continue;

          // ESPN puts “statistics” as array of groups; the "totals" group usually has totals
          // Try to find totals row; fallback to first group
          const statGroups = a?.statistics ?? a?.stats ?? [];
          let totals: any = null;
          for (const g of statGroups) {
            if (g?.name?.toLowerCase?.() === "totals" || g?.type?.toLowerCase?.() === "totals") { totals = g; break; }
          }
          if (!totals && statGroups.length > 0) totals = statGroups[0];

          // Different feeds use different property names; normalize carefully
          const row = {
            points: Number(totals?.points ?? totals?.stats?.points ?? 0),
            reboundsTotal: Number(totals?.rebounds ?? totals?.reboundsTotal ?? 0),
            assists: Number(totals?.assists ?? 0),
            steals: Number(totals?.steals ?? 0),
            blocks: Number(totals?.blocks ?? 0),
            turnovers: Number(totals?.turnovers ?? 0),
            threePointersMade: Number(totals?.threePointersMade ?? totals?.threePointFieldGoalsMade ?? totals?.fg3 ?? 0),
            minutes: (() => {
              const m = totals?.minutes ?? totals?.min ?? null;
              if (m == null) return null;
              if (typeof m === "number") return m;
              // Formats like "31:45" → convert to decimal minutes
              const mm = String(m);
              const parts = mm.split(":").map((x: string) => parseInt(x, 10));
              if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
                return parts[0] + parts[1] / 60;
              }
              return null;
            })(),
          };

          const fpts = fp(row);
          points.set(id, (points.get(id) ?? 0) + fpts);

          const prev = stats.get(id) ?? { pts:0, reb:0, ast:0, stl:0, blk:0, tov:0, fg3m:0, min:0 as number | null };
          const next: Totals = {
            pts: prev.pts + row.points,
            reb: prev.reb + row.reboundsTotal,
            ast: prev.ast + row.assists,
            stl: prev.stl + row.steals,
            blk: prev.blk + row.blocks,
            tov: prev.tov + row.turnovers,
            fg3m: prev.fg3m + row.threePointersMade,
            min: (prev.min ?? 0) + (row.minutes ?? 0),
          };
          stats.set(id, next);
        }
      }
    }

    return NextResponse.json({
      date,
      count: points.size,
      points: Object.fromEntries(points),
      stats: Object.fromEntries(stats),
    }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "nba/stats failed" }, { status: 502 });
  }
}
