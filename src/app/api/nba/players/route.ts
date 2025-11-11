// Next.js App Router
import { NextResponse } from "next/server";

function toYYYYMMDD(dateStr?: string) {
  // accept YYYY-MM-DD and convert to ESPN YYYYMMDD (America/New_York)
  const d = dateStr ? new Date(dateStr + "T12:00:00-05:00") : new Date();
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(d); // YYYY-MM-DD
  return ny.replaceAll("-", "");
}

export const revalidate = 60; // cache 60s on Vercel

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date") || undefined;
    const yyyymmdd = toYYYYMMDD(dateParam);

    // ESPN scoreboard (correct host)
    const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;
    const sbRes = await fetch(sbUrl, { cache: "no-store" });
    if (!sbRes.ok) {
      return NextResponse.json({ error: `scoreboard ${sbRes.status}` }, { status: sbRes.status });
    }
    const sb = await sbRes.json();
    const events: any[] = sb?.events ?? [];
    if (!events.length) {
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    // Collect unique ESPN team IDs playing that day
    const teamIds = new Set<string>();
    for (const ev of events) {
      const comps = ev?.competitions?.[0]?.competitors ?? [];
      for (const c of comps) {
        const id = c?.team?.id;
        if (id) teamIds.add(String(id));
      }
    }

    // Fetch rosters for those teams
    const players: { id: string; name: string; team: string; posNBA: "G"|"F"|"C" }[] = [];

    const fetches = Array.from(teamIds).map(async (tid) => {
      const teamUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${tid}?enable=logos,roster`;
      const tRes = await fetch(teamUrl, { cache: "no-store" });
      if (!tRes.ok) return;
      const tJson = await tRes.json();
      const teamName = tJson?.team?.displayName ?? tJson?.team?.name ?? "NBA";
      const roster = tJson?.team?.athletes ?? tJson?.athletes ?? [];

      for (const group of roster) {
        const aths = group?.items ?? [];
        for (const a of aths) {
          const pid = String(a?.id ?? "");
          const full = a?.displayName ?? a?.fullName ?? "";
          if (!pid || !full) continue;

          // Map ESPN position into G/F/C
          const raw = (a?.position?.abbreviation ?? a?.position?.name ?? "").toUpperCase();
          let pos: "G"|"F"|"C" = "F";
          if (raw.includes("G")) pos = "G";
          else if (raw.includes("C")) pos = "C";
          else pos = "F";

          players.push({ id: pid, name: full, team: teamName, posNBA: pos });
        }
      }
    });

    await Promise.all(fetches);

    // Deduplicate by id (if a player appears twice)
    const uniq = Array.from(
      new Map(players.map(p => [p.id, p])).values()
    ).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ players: uniq }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
