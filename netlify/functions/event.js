// netlify/functions/event.js

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(data),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const SHEETDB_URL = process.env.SHEETDB_URL;
  if (!SHEETDB_URL) {
    return jsonResponse(500, { ok: false, error: "Missing SHEETDB_URL env var" });
  }

  // For debugging
  console.log("SHEETDB_URL prefix:", String(SHEETDB_URL).slice(0, 120));


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
    event_value,
    page_url,
    referrer,
    user_agent,
  };

  // Option A: SHEETDB_URL already contains ?token=...
  const SHEET_NAME = "Events";
  const joiner = SHEETDB_URL.includes("?") ? "&" : "?";
  const url = `${SHEETDB_URL}${joiner}sheet=${encodeURIComponent(SHEET_NAME)}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
