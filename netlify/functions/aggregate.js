// netlify/functions/aggregate.js

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
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

  // ✅ IMPORTANT: set this to the exact tab name in Google Sheets
  // If your tab is called "responses", use "responses"
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
        details: text.slice(0, 300),
      });
    }

    let rows;
    try {
      rows = JSON.parse(text);
    } catch {
      return jsonResponse(502, { ok: false, error: "Invalid JSON from SheetDB" });
    }

    // Count unique user_id values (prod only)
    const uniqueUsers = new Set();
    for (const r of rows) {
      if (String(r.env || "") !== "prod") continue; // optional but recommended
      const uid = String(r.user_id || "").trim();
      if (uid) uniqueUsers.add(uid);
    }

    return jsonResponse(200, { ok: true, n: uniqueUsers.size });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: "Aggregation failed", details: String(err) });
  }
};
