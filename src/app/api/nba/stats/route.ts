// Next.js (app router) – NBA per-game stats + fantasy points for a given date
import type { NextRequest } from "next/server";

function yyyymmddFrom(req: NextRequest): string {
  const url = new URL(req.url);
  const q = url.searchParams.get("date");
  const to8 = (s: string) => s.replaceAll("-", "").slice(0, 8);
  if (q) return to8(q);

  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = fmt.format(new Date()).split("-");
  return `${y}${m}${d}`;
}

// simple fantasy formula (tweak as you like)
function fp(s: any) {
  const pts = Number(s?.points ?? s?.statistics?.points ?? s?.pts ?? 0);
  const reb = Number(s?.rebounds ?? s?.reb ?? 0);
  const ast = Number(s?.assists ?? s?.ast ?? 0);
  const stl = Number(s?.steals ?? s?.stl ?? 0);
  const blk = Number(s?.blocks ?? s?.blk ?? 0);
  const tov = Number(s?.turnovers ?? s?.tov ?? 0);
  const fg3 = Number(s?.threePointersMade ?? s?.fg3m ?? 0);
  return pts + 1.2*reb + 1.5*ast + 3*stl + 3*blk - 1*tov + 0.5*fg3;
}

export async function GET(req: NextRequest) {
  try {
    const ymd = yyyymmddFrom(req);

    // 1) Get events for the day
    const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ymd}`;
    const sb = await fetch(sbUrl, { cache: "no-store" });
    if (!sb.ok) return Response.json({ error: `scoreboard ${sb.status}` }, { status: 502 });
    const sbJson = await sb.json();
    const eventIds: string[] = (sbJson?.events ?? []).map((e: any) => String(e?.id)).filter(Boolean);

    const stats: Record<string, any> = {};
    const points: Record<string, number> = {};

    // 2) For each game, read the summary (box score has per-player lines)
    await Promise.all(
      eventIds.map(async (eid) => {
        const sumUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eid}`;
        const res = await fetch(sumUrl, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        const box = j?.boxscore?.players ?? [];
        for (const side of box) {
          for (const pl of side?.statistics ?? []) {
            const a = pl?.athlete;
            const pid = String(a?.id ?? "");
            if (!pid) continue;

            // ESPN mixes totals in 'stats' and/or normalized fields; keep the common ones
            const line = {
              pts: Number(pl?.statistics?.find?.((x:any)=>x.name==="points")?.value ?? pl?.points ?? 0),
              reb: Number(pl?.statistics?.find?.((x:any)=>x.name==="rebounds")?.value ?? pl?.rebounds ?? 0),
              ast: Number(pl?.statistics?.find?.((x:any)=>x.name==="assists")?.value ?? pl?.assists ?? 0),
              stl: Number(pl?.statistics?.find?.((x:any)=>x.name==="steals")?.value ?? pl?.steals ?? 0),
              blk: Number(pl?.statistics?.find?.((x:any)=>x.name==="blocks")?.value ?? pl?.blocks ?? 0),
              tov: Number(pl?.statistics?.find?.((x:any)=>x.name==="turnovers")?.value ?? pl?.turnovers ?? 0),
              fg3m: Number(pl?.statistics?.find?.((x:any)=>x.name==="threePointersMade")?.value ?? pl?.threePointersMade ?? 0),
              min: pl?.minutes ?? null,
            };

            stats[pid] = line;
            points[pid] = fp(line);
          }
        }
      })
    );

    return Response.json({ stats, points });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
