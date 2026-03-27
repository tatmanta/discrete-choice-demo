// netlify/functions/distribution.js
// Read responses from Google Sheets, dedupe by user_id, return distribution

const { google } = require("googleapis");

const SHEET_NAME = "responses";

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

exports.handler = async () => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_SHEET_ID) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing Google Sheets env vars" }),
    };
  }

  try {
    const sheets = getSheets();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}`,
    });

    const rawRows = resp.data.values;
    if (!rawRows || rawRows.length < 2) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
        body: JSON.stringify({ n: 0, buckets: [] }),
      };
    }

    // First row is the header
    const headers = rawRows[0];
    const userIdIdx = headers.indexOf("user_id");
    const personaIdx = headers.indexOf("winner_persona_name");
    const createdIdx = headers.indexOf("created_at_utc");

    if (userIdIdx === -1 || personaIdx === -1) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing expected columns in sheet" }),
      };
    }

    // Dedupe: latest persona per user_id
    const latestByUser = new Map();
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const userId = String(row[userIdIdx] || "").trim();
      const persona = String(row[personaIdx] || "").trim();
      if (!userId || !persona) continue;

      const t = createdIdx !== -1 ? (Date.parse(String(row[createdIdx] || "")) || 0) : 0;
      const prev = latestByUser.get(userId);
      if (!prev || t >= prev.t) latestByUser.set(userId, { t, persona });
    }

    const counts = new Map();
    for (const { persona } of latestByUser.values()) {
      counts.set(persona, (counts.get(persona) || 0) + 1);
    }

    const n = latestByUser.size;

    // Baseline fallback: if fewer than 100 deduplicated responses, return
    // hardcoded baseline percentages (with real n) so the chart is useful.
    const BASELINE_THRESHOLD = 100;
    if (n < BASELINE_THRESHOLD) {
      const baselineData = [
        { label: "The Comfort Guardian", pctRaw: 25.2 },
        { label: "The Legacy Weaver",    pctRaw: 24.7 },
        { label: "The Peace Seeker",     pctRaw: 19.0 },
        { label: "The Order Keeper",     pctRaw: 17.5 },
        { label: "The Trusted Soul",     pctRaw: 13.7 },
      ];
      const baselineBuckets = baselineData.map(b => ({
        label: b.label,
        count: Math.round((b.pctRaw / 100) * n),
        pct: Math.round(b.pctRaw),
      }));
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
        body: JSON.stringify({ n, baseline: true, buckets: baselineBuckets }),
      };
    }

    const buckets = Array.from(counts.entries())
      .map(([label, count]) => ({
        label: String(label),
        count: Number(count),
        pct: n > 0 ? Math.round((Number(count) / n) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
      body: JSON.stringify({ n, buckets }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Distribution aggregation failed", details: String(err) }),
    };
  }
};
