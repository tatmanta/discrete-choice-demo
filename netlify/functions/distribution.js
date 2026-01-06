// netlify/functions/distribution.js

export async function handler() {
  const SHEETDB_URL = process.env.SHEETDB_URL;
  const TOKEN = process.env.SHEETDB_BEARER_TOKEN;

  if (!SHEETDB_URL || !TOKEN) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing SheetDB env vars" }),
    };
  }

  const SHEET_NAME = "Submissions";
  const url = `${SHEETDB_URL}?sheet=${encodeURIComponent(SHEET_NAME)}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "SheetDB read failed",
          status: resp.status,
          details: String(text || "").slice(0, 300),
        }),
      };
    }

    const rows = await resp.json();

    if (!Array.isArray(rows)) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unexpected SheetDB response" }),
      };
    }

    // 1) Dedup by user_id (keep latest created_at_utc)
    const latestByUser = new Map();

    for (const r of rows) {
      const userId = String(r?.user_id || "").trim();
      const persona = String(r?.winner_persona_name || "").trim();
      if (!userId || !persona) continue;

      const t = Date.parse(String(r?.created_at_utc || "")) || 0;

      const prev = latestByUser.get(userId);
      if (!prev || t >= prev.t) {
        latestByUser.set(userId, { t, persona });
      }
    }

    // 2) Count personas across unique users
    const counts = new Map();
    for (const { persona } of latestByUser.values()) {
      counts.set(persona, (counts.get(persona) || 0) + 1);
    }

    const n = latestByUser.size;

    // 3) Format buckets sorted by count desc
    const buckets = Array.from(counts.entries())
      .map(([label, count]) => ({
        label: String(label),
        count: Number(count),
        pct: n > 0 ? Math.round((Number(count) / n) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        n,
        buckets,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Distribution aggregation failed",
        details: String(err),
      }),
    };
  }
}
