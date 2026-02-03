// netlify/functions/event.js

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(data),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const SHEETDB_URL = process.env.SHEETDB_URL;              // e.g. https://sheetdb.io/api/v1/2olmo0dqgayt4
  const TOKEN = process.env.SHEETDB_BEARER_TOKEN;           // bearer token value (NOT in the URL)

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
    event_detail = "",
    page_url = "",
    referrer = "",
    user_agent = "",
    user_id = "",
  } = body;

  if (!session_id || !event_name) {
    return jsonResponse(400, { ok: false, error: "Missing session_id or event_name" });
  }

  const nowIso = new Date().toISOString();

  // safer UUID
  const event_id =
    (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const row = {
    event_id,
    created_at_utc: nowIso,
    app_version,
    env,
    session_id,
    client_run_id,
    event_name,
    event_detail: String(event_detail ?? ""),
    page_url,
    referrer,
    user_agent,
    user_id
  };

  // ✅ Use Bearer auth + sheet param
  const SHEET_NAME = "Events";
  const url = `${SHEETDB_URL}?sheet=${encodeURIComponent(SHEET_NAME)}`;

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
        used_url: url,
        details: text.slice(0, 300),
      });
    }

    return jsonResponse(200, { ok: true, event_id });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: "Unexpected error", details: String(err) });
  }
};
