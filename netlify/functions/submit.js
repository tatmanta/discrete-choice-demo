// netlify/functions/submit.js

const SHEET = "responses"; // your Sheet tab name

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

exports.handler = async (event) => {
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
    app_version,
    env,
    session_id,
    client_run_id,
    dedupe_key,
    dedupe_window_minutes,
    block_index,
    n_questions,
    answers_json,
    attr_scores_json,
    winner_attr_index,
    winner_value_type,
    winner_persona_name,
    timezone,
    language,
    user_agent,
    referrer,
    page_url,
    user_id,
  } = body;

  // Minimal validation
  if (!session_id || !client_run_id || !dedupe_key) {
    return jsonResponse(400, { ok: false, error: "Missing required identifiers (session_id, client_run_id, dedupe_key)" });
  }

  const nowIso = new Date().toISOString();
  const response_id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);

  // 1) DEDUPE CHECK (search by dedupe_key)
  // SheetDB supports: /search?dedupe_key=...
  // If you named the header differently, update this field name.
  const searchUrl = `${SHEETDB_URL}/search?sheet=${encodeURIComponent(SHEET)}&dedupe_key=${encodeURIComponent(dedupe_key)}`;

  let existing = [];
  try {
    const r = await fetch(searchUrl, {
      method: "GET",
      headers: { "Authorization": `Bearer ${TOKEN}` },
    });
    if (r.ok) existing = await r.json();
  } catch (_) {
    // If search fails, we don't hard-fail the submission; we can still accept and write.
    existing = [];
  }

  // If any existing row is within dedupe window, reject
  const windowMs = Math.max(1, Number(dedupe_window_minutes || 60)) * 60 * 1000;
  const nowMs = Date.now();

  const isDup = Array.isArray(existing) && existing.some(row => {
    const ts = row.created_at_utc;
    const ms = ts ? Date.parse(ts) : NaN;
    if (Number.isNaN(ms)) return false;
    return (nowMs - ms) <= windowMs;
  });

  if (isDup) {
    return jsonResponse(200, { ok: true, deduped: true, response_id: null });
  }

  // 2) WRITE ROW
  const row = {
    response_id,
    created_at_utc: nowIso,
    app_version: app_version || "",
    env: env || "",
    session_id,
    client_run_id,
    dedupe_key,
    dedupe_window_minutes: String(dedupe_window_minutes || 60),
    block_index: String(block_index ?? ""),
    n_questions: String(n_questions ?? ""),
    answers_json: answers_json || "",
    attr_scores_json: attr_scores_json || "",
    winner_attr_index: String(winner_attr_index ?? ""),
    winner_value_type: winner_value_type || "",
    winner_persona_name: winner_persona_name || "",
    timezone: timezone || "",
    language: language || "",
    user_agent: user_agent || "",
    referrer: referrer || "",
    page_url: page_url || "",
    user_id: user_id || "",
  };

  const writeUrl = `${SHEETDB_URL}?sheet=${encodeURIComponent(SHEET)}`;

  try {
    const w = await fetch(writeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ data: [row] }),
    });

    if (!w.ok) {
      const txt = await w.text();
      return jsonResponse(502, { ok: false, error: "SheetDB write failed", detail: txt });
    }
  } catch (e) {
    return jsonResponse(502, { ok: false, error: "SheetDB write exception", detail: String(e) });
  }

  return jsonResponse(200, { ok: true, deduped: false, response_id });
};
