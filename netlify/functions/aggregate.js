export async function handler() {
  const SHEETDB_URL = process.env.SHEETDB_URL;
  const TOKEN = process.env.SHEETDB_BEARER_TOKEN;

  if (!SHEETDB_URL || !TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing SheetDB env vars" })
    };
  }

  const SHEET_NAME = "Submissions";
  const url = `${SHEETDB_URL}?sheet=${encodeURIComponent(SHEET_NAME)}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${TOKEN}`
      }
    });

    const rows = await resp.json();

    // Count unique user_id values
    const uniqueUsers = new Set();
    rows.forEach(r => {
      if (r.user_id) uniqueUsers.add(r.user_id);
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: uniqueUsers.size })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Aggregation failed" })
    };
  }
}
