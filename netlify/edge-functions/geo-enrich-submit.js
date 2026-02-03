export default async (request, context) => {
  // Let non-POST pass through to the origin function
  if (request.method !== "POST") return context.next();

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const geo = context.geo || {};

  const enriched = {
    ...body,
    geo_country: geo.country?.code || "",
    geo_region: geo.subdivision?.code || "",
    geo_city: geo.city || "",
    geo_timezone: geo.timezone || "",
  };

  // Forward to your origin Netlify Function at the same path
  const newReq = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(enriched),
  });

  const resp = await context.next(newReq);

  // Non-prod check for Netlify geo function run
  if ((enriched.env || "") !== "prod") out.headers.set("x-edge-ran", "1");

};
