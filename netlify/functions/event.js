// netlify/functions/event.js

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", // ok for prototype; tighten later if needed
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(data),
  };
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const SHEETDB_URL = process.env.SHEETDB_URL;
  const TOKEN = process.env.SHEETDB_BEARER_TOKEN;

  if (!SHEETDB_URL) return jsonResponse(500, { ok: false, error: "Missing SHEETDB_URL env var" });
  if (!TOKEN) return jsonResponse(500, { ok: false, error: "Missing SHEETDB_BEARER_TOKEN env var" });

  const body = safeJsonParse(event.body || "");
  if (!body) return jsonResponse(400, { ok: false, error: "Invalid JSON" });

  const {
    app_version = "",
    env = "",
    session_id = "",
    client_run_id = "",
    event_name = "",
    event_value = "",
    page_url = "",
    referrer = "",
    user_agent = "",
  } = body;

  // Minimal validation
  if (!session_id || !event_name) {
    return jsonResponse(400, { ok: false, error: "Missing required fields: session_id, event_name" });
  }

  // Build row to match your "events" headers
  const nowIso = new Date().toISOString();
  const event_id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;

  const row = {
    event_id,
    created_at_utc: nowIso,
    app_version,
    env,
    session_id,
    client_run_id,
    event_name,
    event_value,
    page_url,
    referrer,
    user_agent,
  };

  // SheetDB: write to "events" tab
  // IMPORTANT: your Google Sheet must have a tab named exactly: events
  const url = `${SHEETDB_URL}/events`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ data: [row] }),
    });

    const text = await resp.text();
    if (!resp.ok) {
      return jsonResponse(502, {
        ok: false,
        error: "SheetDB write failed",
        status: resp.status,
        details: text,
      });
    }

    return jsonResponse(200, { ok: true, event_id });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: "Unexpected error", details: String(err) });
  }
};
