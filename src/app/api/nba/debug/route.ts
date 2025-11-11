import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SB = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

function compact(d: string) { return d.replaceAll("-", ""); }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0,10);
  const url = `${SB}?dates=${compact(date)}`;
  try {
    const r = await fetch(url, { cache: "no-store", headers: { "User-Agent": "FH/1.0" } });
    const ok = r.ok;
    const status = r.status;
    const j = ok ? await r.json() : null;
    return NextResponse.json({
      ok, status,
      url,
      eventsCount: Array.isArray(j?.events) ? j.events.length : null,
      sampleEventKeys: j?.events?.[0] ? Object.keys(j.events[0]) : [],
      hasCompetitions: !!j?.events?.[0]?.competitions,
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e), url }, { status: 500 });
  }
}
