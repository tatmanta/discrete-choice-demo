export default async function geoEnrichSubmit(request, context) {
  if (request.method !== "POST") {
    return context.next();
  }

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
    return context.next();
  }

  const geo = context.geo || {};

  body.geo_country =
    body.geo_country ||
    geo.country?.code ||
    geo.country?.name ||
    geo.country ||
    "";

  body.geo_region =
    body.geo_region ||
    geo.subdivision?.code ||
    geo.subdivision?.name ||
    geo.region ||
    "";

  body.geo_city = body.geo_city || geo.city || "";
  body.geo_timezone = body.geo_timezone || geo.timezone || "";

  // IMPORTANT: fix content-length when forwarding modified body
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  return fetch(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
  });
}
