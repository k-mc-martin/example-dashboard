import { request as httpRequest } from "node:http";

const DEFAULT_MAX_RESPONSE_BYTES = 4096;

export function localFetch(input, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(input); } catch { reject(new Error("invalid local URL")); return; }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.hash) {
      reject(new Error("only loopback HTTP is allowed")); return;
    }
    const signal = options.signal;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 128 * 1024) { reject(new Error("invalid response limit")); return; }
    const requestBody = options.body === undefined ? null : Buffer.from(options.body);
    if (requestBody && requestBody.length > 4096) { reject(new Error("request body too large")); return; }
    if (signal?.aborted) { reject(signal.reason ?? new Error("request aborted")); return; }
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? "GET",
      headers: options.headers,
    }, response => {
      const declared = response.headers["content-length"];
      if (declared !== undefined) {
        const length = Number(Array.isArray(declared) ? declared[0] : declared);
        if (!Number.isSafeInteger(length) || length < 0 || length > maxResponseBytes) {
          response.destroy(); reject(new Error("invalid response length")); return;
        }
      }
      const chunks = []; let total = 0;
      response.on("data", chunk => {
        total += chunk.length;
        if (total > maxResponseBytes) response.destroy(new Error("response too large"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const body = Buffer.concat(chunks, total).toString("utf8");
        const headers = { get(name) {
          const value = response.headers[String(name).toLowerCase()];
          return value === undefined ? null : Array.isArray(value) ? value.join(", ") : String(value);
        } };
        resolve({ ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300, status: response.statusCode ?? 0, headers, body: null, text: async () => body });
      });
    });
    const abort = () => request.destroy(signal.reason ?? new Error("request aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal?.removeEventListener("abort", abort));
    request.on("error", reject);
    request.end(requestBody ?? undefined);
  });
}
