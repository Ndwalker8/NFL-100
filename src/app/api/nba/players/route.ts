// Next.js (app router) – NBA players for a given date
import type { NextRequest } from "next/server";

function yyyymmddFrom(req: NextRequest): string {
  const url = new URL(req.url);
  const q = url.searchParams.get("date"); // accepts YYYY-MM-DD or YYYYMMDD
  const to8 = (s: string) => s.replaceAll("-", "").slice(0, 8);
  if (q) return to8(q);

  // default: today in America/New_York
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = fmt.format(new Date()).split("-");
  return `${y}${m}${d}`;
}

export async function GET(req: NextRequest) {
  try {
    const ymd = yyyymmddFrom(req);

    // 1) Which teams play today?
    const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ymd}`;
    const sb = await fetch(sbUrl, { cache: "no-store" });
    if (!sb.ok) return Response.json({ error: `scoreboard ${sb.status}` }, { status: 502 });
    const sbJson = await sb.json();

    const teamIds: Set<number> = new Set();
    for (const ev of sbJson?.events ?? []) {
      const comp = ev?.competitions?.[0];
      for (const c of comp?.competitors ?? []) {
        const id = Number(c?.team?.id);
        if (Number.isFinite(id)) teamIds.add(id);
      }
    }
    // If no games, return empty list (off days)
    if (!teamIds.size) return Response.json({ players: [] });

    // 2) Pull rosters for each team
    const players: Array<{ id: string; name: string; team: string; posNBA: "C" | "F" | "G" }> = [];
    await Promise.all(
      Array.from(teamIds).map(async (tid) => {
        const rUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${tid}/roster`;
        const rRes = await fetch(rUrl, { cache: "no-store" });
        if (!rRes.ok) return;
        const rJson = await rRes.json();
        const teamAbbr = rJson?.team?.abbreviation ?? rJson?.team?.shortDisplayName ?? "NBA";
        for (const grp of rJson?.athletes ?? []) {
          for (const a of grp?.items ?? []) {
            const id = String(a?.id ?? "");
            const name = a?.displayName ?? a?.fullName ?? "";
            const pos = (a?.position?.abbreviation ?? "").toUpperCase();
            if (!id || !name) continue;
            // ESPN uses C / F / G; keep that and let UI map F→PF/SF, G→SG/PG
            const posNBA = (pos === "C" || pos === "F" || pos === "G") ? pos : ("G" as const);
            players.push({ id, name, team: teamAbbr, posNBA });
          }
        }
      })
    );

    // de-dupe just in case
    const seen = new Set<string>();
    const unique = players.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));

    return Response.json({ players: unique });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
