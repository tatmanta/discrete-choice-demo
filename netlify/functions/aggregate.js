// netlify/functions/aggregate.js

function jsonResponse(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const SHEETDB_URL = process.env.SHEETDB_URL;
  const TOKEN = process.env.SHEETDB_BEARER_TOKEN;

  if (!SHEETDB_URL || !TOKEN) {
    return jsonResponse(500, { ok: false, error: "Missing SheetDB env vars" });
  }

  const SHEET_NAME = "responses";
  const url = `${SHEETDB_URL}?sheet=${encodeURIComponent(SHEET_NAME)}`;

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    const text = await resp.text();

    if (!resp.ok) {
      return jsonResponse(502, {
        ok: false,
        error: "SheetDB read failed",
        status: resp.status,
        details: String(text || "").slice(0, 300),
      });
    }

    let rows;
    try {
      rows = JSON.parse(text);
    } catch {
      return jsonResponse(502, { ok: false, error: "Invalid JSON from SheetDB" });
    }

    if (!Array.isArray(rows)) {
      return jsonResponse(500, { ok: false, error: "Unexpected SheetDB response" });
    }

    // Latest persona per user
    const latestByUser = new Map();

    for (const r of rows) {
      // OPTIONAL: filter to prod only (uncomment if you want)
      // if (String(r?.env || "") !== "prod") continue;

      const userId = String(r?.user_id || "").trim();
      const persona = String(r?.winner_persona_name || "").trim();
      if (!userId || !persona) continue;

      const t =
        Date.parse(String(r?.created_at_utc || "")) ||
        Date.parse(String(r?.created_at || "")) ||
        0;

      const prev = latestByUser.get(userId);
      if (!prev || t >= prev.t) latestByUser.set(userId, { t, persona });
    }

    const counts = new Map();
    for (const { persona } of latestByUser.values()) {
      counts.set(persona, (counts.get(persona) || 0) + 1);
    }

    const n = latestByUser.size;

    const buckets = Array.from(counts.entries())
      .map(([label, count]) => ({
        label: String(label),
        count: Number(count),
        pct: n > 0 ? Math.round((Number(count) / n) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return jsonResponse(200, { ok: true, n, buckets });
  } catch (err) {
    return jsonResponse(500, {
      ok: false,
      error: "Aggregation failed",
      details: String(err),
    });
  }
};