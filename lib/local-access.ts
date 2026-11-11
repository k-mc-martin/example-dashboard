/** Host/CSRF defense in depth; privacy also requires the loopback-only listener. */
export function isLocalRequest(request: Request): boolean {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  if (!["127.0.0.1:5286", "localhost:5286"].includes(host) || !["127.0.0.1", "localhost"].includes(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
export function denied() { return Response.json({ error: "This dashboard is available only on this Mac." }, { status: 403 }); }
