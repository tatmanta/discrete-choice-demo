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

/**
 * ✅ Robust SheetDB URL builder:
 * - Supports SHEETDB_URL like:
 *   - https://sheetdb.io/api/v1/XXXX
 *   - https://sheetdb.io/api/v1/XXXX?token=YYYY
 * - Preserves any existing query params (e.g., token=...)
 * - Appends path segments correctly (no "...?token=.../search" bugs)
 */
function makeSheetdbUrlBuilder(rawUrl) {
  const u = new URL(rawUrl);
  const basePath = u.pathname.replace(/\/+$/, ""); // remove trailing slash
  const base = `${u.origin}${basePath}`;

  // capture any existing query params (e.g., token=...)
  const baseParams = new URLSearchParams(u.search);

  return function build(path = "", params = {}) {
    const url = new URL(base + path);

    // keep original params (token, etc.)
    baseParams.forEach((v, k) => url.searchParams.set(k, v));

    // add/override extra params
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      url.searchParams.set(k, String(v));
    });

    return url.toString();
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const SHEETDB_URL = process.env.SHEETDB_URL;
  const TOKEN = process.env.SHEETDB_BEARER_TOKEN; // optional depending on your SheetDB auth setup

  if (!SHEETDB_URL) return jsonResponse(500, { ok: false, error: "Missing SHEETDB_URL env var" });

  // Build URLs safely even if SHEETDB_URL already has ?token=...
  let buildUrl;
  try {
    buildUrl = makeSheetdbUrlBuilder(SHEETDB_URL);
  } catch {
    return jsonResponse(500, { ok: false, error: "Invalid SHEETDB_URL env var (must be a valid URL)" });
  }

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
    geo_country,
    geo_region,
    geo_city,
    geo_timezone,
    demo_age,
    demo_gender,
    demo_gender_self,
    demo_education,
    demo_education_other,
  } = body;

  // Minimal validation
  if (!session_id || !client_run_id || !dedupe_key) {
    return jsonResponse(400, { ok: false, error: "Missing required identifiers (session_id, client_run_id, dedupe_key)" });
  }

  const nowIso = new Date().toISOString();
  const response_id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);

  // Optional debug (remove later)
  console.log("[submit] sheetdb base:", SHEETDB_URL.split("?")[0]);
  console.log("[submit] sheet:", SHEET);

  // Common headers (Authorization only if provided)
  const headersAuth = TOKEN ? { "Authorization": `Bearer ${TOKEN}` } : {};

  // 1) DEDUPE CHECK (search by dedupe_key)
  // SheetDB supports: /search?dedupe_key=...
  const searchUrl = buildUrl("/search", { sheet: SHEET, dedupe_key });

  let existing = [];
  try {
    const r = await fetch(searchUrl, {
      method: "GET",
      headers: { ...headersAuth },
    });
    if (r.ok) existing = await r.json();
    else console.log("[submit] dedupe search non-200:", r.status, await r.text().catch(() => ""));
  } catch (e) {
    console.log("[submit] dedupe search exception:", String(e));
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
    geo_country: geo_country || "",
    geo_region: geo_region || "",
    geo_city: geo_city || "",
    geo_timezone: geo_timezone || "",
    demo_age: String(demo_age ?? ""),
    demo_gender: demo_gender || "",
    demo_gender_self: demo_gender_self || "",
    demo_education: demo_education || "",
    demo_education_other: demo_education_other || "",
  };

  // ✅ Correct write URL even with token in SHEETDB_URL
  const writeUrl = buildUrl("", { sheet: SHEET });

  try {
    const w = await fetch(writeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headersAuth,
      },
      body: JSON.stringify({ data: [row] }),
    });

    if (!w.ok) {
      const txt = await w.text().catch(() => "");
      console.log("[submit] write failed:", w.status, txt);
      return jsonResponse(502, { ok: false, error: "SheetDB write failed", detail: txt });
    }
  } catch (e) {
    console.log("[submit] write exception:", String(e));
    return jsonResponse(502, { ok: false, error: "SheetDB write exception", detail: String(e) });
  }

  return jsonResponse(200, { ok: true, deduped: false, response_id });
};