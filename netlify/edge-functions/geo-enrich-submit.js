export default async function handler(request, context) {
  return new Response("edge-ok", { status: 200 });
}
