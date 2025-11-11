import { NextResponse } from "next/server";

export const runtime = "edge";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Player = {
  id: string;
  name: string;
  team: string | null;
  posNBA: "C" | "F" | "G";
  active: boolean;
};

async function fetchAllPlayers(): Promise<any[]> {
  // If you have a key, set BALLDONTLIE_API_KEY in your env and it’ll be sent.
  const key = process.env.BALLDONTLIE_API_KEY;
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;

  const base = "https://api.balldontlie.io/v1/players?per_page=100&active=true";
  let page = 1;
  const out: any[] = [];
  for (;;) {
    const r = await fetch(`${base}&page=${page}`, { cache: "no-store", headers });
    if (!r.ok) throw new Error(`players ${r.status}`);
    const j = await r.json();
    out.push(...(j.data ?? []));
    if (!j.meta || page >= j.meta.total_pages) break;
    page++;
  }
  return out;
}

export async function GET() {
  try {
    const raw = await fetchAllPlayers();
    const players: Player[] = raw.map((p: any) => {
      const pos = String(p.position || "").toUpperCase();
      const posNBA = (pos === "C" ? "C" : pos === "F" ? "F" : "G") as Player["posNBA"];
      const team = p.team?.abbreviation ?? null;
      return {
        id: String(p.id),
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        team,
        posNBA,
        active: true,
      };
    }).filter(p => p.name);

    players.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ count: players.length, players }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "nba/players failed" }, { status: 502 });
  }
}

