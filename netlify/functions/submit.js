// netlify/functions/submit.js
// Append-only write to Google Sheets "responses" tab

const { google } = require("googleapis");

const SHEET_NAME = "responses";

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

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function appendWithRetry(sheets, spreadsheetId, values, { tries = 3, baseDelayMs = 500 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [values] },
      });
      return { ok: true, res };
    } catch (e) {
      last = e;
      const status = e?.response?.status || e?.code;
      // Only retry on rate-limit or server errors
      if (status === 429 || (status >= 500 && status <= 599)) {
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Non-retryable error
      return { ok: false, error: e };
    }
  }
  return { ok: false, error: last };
}

// Column order — must match the sheet header row exactly
const COLUMNS = [
  "response_id", "created_at_utc", "updated_at_utc",
  "app_version", "env",
  "session_id", "client_run_id",
  "block_index", "n_questions", "answers_json", "attr_scores_json",
  "winner_attr_index", "winner_value_type", "winner_persona_name",
  "referrer", "page_url",
  "user_id", "geo_country", "geo_region", "geo_city", "geo_timezone",
  "demo_age", "demo_gender", "demo_gender_self", "demo_education", "demo_education_other",
];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
  if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return jsonResponse(500, { ok: false, error: "Missing GOOGLE_SERVICE_ACCOUNT_JSON env var" });
  if (!process.env.GOOGLE_SHEET_ID) return jsonResponse(500, { ok: false, error: "Missing GOOGLE_SHEET_ID env var" });

  const body = safeJsonParse(event.body || "");
  if (!body) return jsonResponse(400, { ok: false, error: "Invalid JSON" });

  const {
    app_version, env,
    session_id, client_run_id,
    block_index, n_questions, answers_json, attr_scores_json,
    winner_attr_index, winner_value_type, winner_persona_name,
    referrer, page_url,
    user_id, geo_country, geo_region, geo_city, geo_timezone,
    demo_age, demo_gender, demo_gender_self, demo_education, demo_education_other,
    created_at_utc,
  } = body;

  if (!session_id || !client_run_id) {
    return jsonResponse(400, {
      ok: false,
      error: "Missing required identifiers (session_id, client_run_id)",
    });
  }

  const nowIso = new Date().toISOString();
  const createdAt = created_at_utc || nowIso;

  const response_id =
    body.response_id ||
    (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);

  const row = {
    response_id,
    created_at_utc: createdAt,
    updated_at_utc: nowIso,
    app_version: app_version || "",
    env: env || "",
    session_id,
    client_run_id,
    block_index: String(block_index ?? ""),
    n_questions: String(n_questions ?? ""),
    answers_json: answers_json || "",
    attr_scores_json: attr_scores_json || "",
    winner_attr_index: String(winner_attr_index ?? ""),
    winner_value_type: winner_value_type || "",
    winner_persona_name: winner_persona_name || "",
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

  // Build values array in column order
  const values = COLUMNS.map(col => row[col]);

  let sheets;
  try {
    sheets = getSheets();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: "Invalid service account credentials", details: String(e) });
  }

  const result = await appendWithRetry(sheets, process.env.GOOGLE_SHEET_ID, values);

  if (!result.ok) {
    const status = result.error?.response?.status || result.error?.code;
    if (status === 429) {
      return jsonResponse(429, {
        ok: false,
        error: "Google Sheets rate limit (429)",
        detail: String(result.error.message || "").slice(0, 600),
      });
    }
    return jsonResponse(502, {
      ok: false,
      error: "Google Sheets write failed",
      detail: String(result.error?.message || result.error || "").slice(0, 600),
    });
  }

  return jsonResponse(200, { ok: true, response_id, mode: "inserted" });
};
