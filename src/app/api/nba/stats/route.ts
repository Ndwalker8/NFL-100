import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Row = {
  player: { id: number };
  team: { abbreviation: string };
  pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg3m: number;
  min: string | null;
};

function fp(row: Row) {
  return (
    (row.pts ?? 0) +
    1.2 * (row.reb ?? 0) +
    1.5 * (row.ast ?? 0) +
    3   * (row.stl ?? 0) +
    3   * (row.blk ?? 0) -
    1   * (row.tov ?? 0)
  );
}

async function fetchStatsByDate(date: string): Promise<Row[]> {
  const key = process.env.BALLDONTLIE_API_KEY;
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;

  const base = `https://api.balldontlie.io/v1/stats?per_page=100&dates[]=${encodeURIComponent(date)}`;
  let page = 1;
  const out: Row[] = [];
  for (;;) {
    const r = await fetch(`${base}&page=${page}`, { cache: "no-store", headers });
    if (!r.ok) throw new Error(`stats ${r.status}`);
    const j = await r.json();
    out.push(...(j.data ?? []));
    if (!j.meta || page >= j.meta.total_pages) break;
    page++;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
    }

    const rows = await fetchStatsByDate(date);
    const points = new Map<string, number>();
    const stats  = new Map<string, any>();
    for (const r of rows) {
      const id = String(r.player?.id ?? "");
      if (!id) continue;
      points.set(id, (points.get(id) ?? 0) + fp(r));
      stats.set(id, {
        pts: r.pts ?? 0, reb: r.reb ?? 0, ast: r.ast ?? 0,
        stl: r.stl ?? 0, blk: r.blk ?? 0, tov: r.tov ?? 0,
        fg3m: r.fg3m ?? 0, min: r.min ?? null,
      });
    }

    return NextResponse.json(
      { date, count: points.size, points: Object.fromEntries(points), stats: Object.fromEntries(stats) },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "nba/stats failed" }, { status: 502 });
  }
}
