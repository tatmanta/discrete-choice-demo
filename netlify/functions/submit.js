const SHEET = "responses";

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

// simple helper: retry on 429/5xx with backoff
async function fetchWithRetry(url, options, { tries = 3, baseDelayMs = 400 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;

      // retry only on 429 or 5xx
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        last = res;
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return res; // non-retriable
    } catch (e) {
      last = e;
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return last; // may be Response or Error
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const SHEETDB_URL = process.env.SHEETDB_URL; // e.g. https://sheetdb.io/api/v1/XXXX
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

  // ✅ IMPORTANT: remove SheetDB "search" dedupe check to avoid doubling requests
  // If you still want dedupe, do it later in analysis using dedupe_key + created_at_utc.

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

  const writeUrl = `${SHEETDB_URL}?sheet=${encodeURIComponent(SHEET)}`;

  const resp = await fetchWithRetry(writeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ data: [row] }),
  }, { tries: 3, baseDelayMs: 500 });

  // fetchWithRetry may return Error
  if (!resp || typeof resp.ok !== "boolean") {
    return jsonResponse(502, { ok: false, error: "SheetDB write exception", detail: String(resp) });
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    // Surface rate limit clearly
    if (resp.status === 429) {
      return jsonResponse(429, { ok: false, error: "SheetDB rate limit (429). Upgrade plan or reduce calls.", detail: txt });
    }
    return jsonResponse(502, { ok: false, error: "SheetDB write failed", status: resp.status, detail: txt });
  }

  return jsonResponse(200, { ok: true, response_id });
};