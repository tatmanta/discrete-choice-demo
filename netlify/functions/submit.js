// netlify/functions/submit.js
// Idempotent upsert keyed by dedupe_key (no full-sheet reads)

const SHEET = "responses";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

async function fetchWithRetry(url, options, { tries = 3, baseDelayMs = 500 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;

      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        last = res;
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return last;
}

async function readTextSafe(res) {
  try { return await res.text(); } catch { return ""; }
}

async function sheetdbUpdateByKey({ baseUrl, token, sheet, column, value, row }) {
  const url =
    `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(column)}/${encodeURIComponent(value)}?sheet=${encodeURIComponent(sheet)}`;

  const res = await fetchWithRetry(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ data: row }),
  });

  if (!res || typeof res.ok !== "boolean") {
    return { ok: false, matchedOrUpdated: false, res: null, bodyText: String(res) };
  }

  const bodyText = await readTextSafe(res);
  const bodyLower = (bodyText || "").toLowerCase();

  // IMPORTANT: only treat as "matched" if we have a positive signal.
  // Many APIs return 200 even when nothing matched; be conservative.
  let matchedOrUpdated = false;

  if (res.ok) {
    // common positive signals
    if (bodyLower.includes("updated") || bodyLower.includes("success")) matchedOrUpdated = true;

    // common numeric signals (varies by plan)
    const bodyJson = safeJsonParse(bodyText);
    const n =
      bodyJson?.updated ??
      bodyJson?.updatedRows ??
      bodyJson?.affected ??
      bodyJson?.rows;

    if (typeof n === "number") matchedOrUpdated = n > 0;
    if (typeof n === "string" && n.trim() !== "") matchedOrUpdated = Number(n) > 0;

    // common negative signals
    if (bodyLower.includes("not found")) matchedOrUpdated = false;
  }

  if (res.status === 404) matchedOrUpdated = false;

  return { ok: res.ok, matchedOrUpdated, res, bodyText: bodyText.slice(0, 600) };
}

async function sheetdbInsert({ baseUrl, token, sheet, row }) {
  const url = `${baseUrl.replace(/\/$/, "")}?sheet=${encodeURIComponent(sheet)}`;

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ data: [row] }),
  });

  if (!res || typeof res.ok !== "boolean") {
    return { ok: false, res: null, bodyText: String(res) };
  }

  const bodyText = await readTextSafe(res);
  return { ok: res.ok, res, bodyText: bodyText.slice(0, 600) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
  if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });

  const SHEETDB_URL = process.env.SHEETDB_URL;
  const TOKEN = process.env.SHEETDB_BEARER_TOKEN;

  if (!SHEETDB_URL) return jsonResponse(500, { ok: false, error: "Missing SHEETDB_URL env var" });
  if (!TOKEN) return jsonResponse(500, { ok: false, error: "Missing SHEETDB_BEARER_TOKEN env var" });

  const body = safeJsonParse(event.body || "");
  if (!body) return jsonResponse(400, { ok: false, error: "Invalid JSON" });

  const {
    app_version, env,
    session_id, client_run_id, dedupe_key, dedupe_window_minutes,
    block_index, n_questions, answers_json, attr_scores_json,
    winner_attr_index, winner_value_type, winner_persona_name,
    timezone, language, user_agent, referrer, page_url,
    user_id, geo_country, geo_region, geo_city, geo_timezone,
    demo_age, demo_gender, demo_gender_self, demo_education, demo_education_other,
    // OPTIONAL: allow client to pass created_at_utc for stability
    created_at_utc,
  } = body;

  if (!session_id || !client_run_id || !dedupe_key) {
    return jsonResponse(400, {
      ok: false,
      error: "Missing required identifiers (session_id, client_run_id, dedupe_key)",
    });
  }

  const nowIso = new Date().toISOString();

  // Make created_at stable if client provided it; else server time.
  const createdAt = created_at_utc || nowIso;

  // Keep a stable id across retries if client provides one; else generate.
  const response_id =
    body.response_id ||
    (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);

  const row = {
    response_id,
    created_at_utc: createdAt,
    updated_at_utc: nowIso, // always bumps on retry/update

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

  // 1) UPDATE existing row where dedupe_key matches
  const upd = await sheetdbUpdateByKey({
    baseUrl: SHEETDB_URL,
    token: TOKEN,
    sheet: SHEET,
    column: "dedupe_key",
    value: dedupe_key,
    row,
  });

  if (upd.ok && upd.matchedOrUpdated) {
    return jsonResponse(200, { ok: true, response_id, mode: "updated" });
  }

  if (upd.res && upd.res.status === 429) {
    return jsonResponse(429, {
      ok: false,
      error: "SheetDB rate limit (429) during update.",
      detail: upd.bodyText || "",
    });
  }

  // 2) INSERT if no match
  const ins = await sheetdbInsert({
    baseUrl: SHEETDB_URL,
    token: TOKEN,
    sheet: SHEET,
    row,
  });

  if (!ins.ok) {
    const status = ins.res?.status;
    if (status === 429) {
      return jsonResponse(429, {
        ok: false,
        error: "SheetDB rate limit (429) during insert.",
        detail: ins.bodyText || "",
      });
    }
    return jsonResponse(502, {
      ok: false,
      error: "SheetDB write failed (update+insert)",
      update_status: upd.res?.status ?? null,
      update_detail: upd.bodyText || "",
      insert_status: status ?? null,
      insert_detail: ins.bodyText || "",
    });
  }

  return jsonResponse(200, { ok: true, response_id, mode: "inserted" });
};