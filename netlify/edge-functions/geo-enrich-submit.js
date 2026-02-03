export default async (request, context) => {
  // Only intercept the survey completion submit
  if (request.method !== "POST") return context.next();

  // Read body text (Edge request bodies are streams)
  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch {
    return context.next();
  }

  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    // Not JSON? pass through
    return context.next();
  }

  const geo = context.geo || {};

  // Normalize across possible shapes
  const country =
    geo.country?.code || geo.country?.name || geo.country || "";

  const region =
    geo.subdivision?.code || geo.subdivision?.name || geo.region || "";

  const city = geo.city || "";

  const tz = geo.timezone || "";

  // Inject into existing payload (don’t overwrite if already set)
  body.geo_country = body.geo_country || country;
  body.geo_region = body.geo_region || region;
  body.geo_city = body.geo_city || city;
  body.geo_timezone = body.geo_timezone || tz;

  // Forward request to the original destination with updated JSON body
  // Preserve method + headers; update content-length implicitly by omitting it
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  return fetch(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
  });
};
