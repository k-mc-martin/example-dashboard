import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeNode, connectBoth, deliveryNode, httpNode, manualNode, safeUpstreamError, scheduleNode, unwrapResponse, workflow } from "./operational-common.mjs";

const statuses = ["pending", "failed", "paid", "refunded", "partial_refund", "fraudulent"];
function emptySlice() { return { orderCount: 0, grossCents: 0, refundedCents: 0, netCents: 0, taxCents: 0, discountCents: 0, byStatus: [], byDay: [], byProduct: [] }; }
export function aggregateLemonSqueezy(pageBodies, observedAt = new Date().toISOString()) {
  const pages = pageBodies.map(item => item?.json ?? item);
  const orders = pages.flatMap(page => Array.isArray(page?.data) ? page.data : []);
  if (!pages.length || pages.some(page => !page?.meta?.page)) throw new Error("invalid_response");
  const lastPage = Math.max(...pages.map(page => Number(page.meta.page.lastPage)));
  const currentPages = new Set(pages.map(page => Number(page.meta.page.currentPage)));
  const complete = Number.isSafeInteger(lastPage) && lastPage > 0 && Array.from({ length: lastPage }, (_, index) => index + 1).every(page => currentPages.has(page));
  const slices = { live: emptySlice(), test: emptySlice() };
  const maps = { live: { status: new Map(), day: new Map(), product: new Map() }, test: { status: new Map(), day: new Map(), product: new Map() } };
  for (const entry of orders) {
    const a = entry?.attributes;
    if (entry?.type !== "orders" || String(a?.store_id) !== "100001" || !statuses.includes(a?.status)) throw new Error("invalid_response");
    const target = a.test_mode === true ? "test" : "live";
    const slice = slices[target];
    const gross = Number(a.total_usd), refunded = Number(a.refunded_amount_usd ?? 0), tax = Number(a.tax_usd ?? 0), discount = Number(a.discount_total_usd ?? 0);
    if (![gross, refunded, tax, discount].every(Number.isSafeInteger) || [gross, refunded, tax, discount].some(value => value < 0) || refunded > gross) throw new Error("invalid_response");
    const financial = ["paid", "refunded", "partial_refund"].includes(a.status);
    const countedGross = financial ? gross : 0, countedRefund = financial ? refunded : 0;
    slice.orderCount += 1; slice.grossCents += countedGross; slice.refundedCents += countedRefund; slice.taxCents += financial ? tax : 0; slice.discountCents += financial ? discount : 0;
    maps[target].status.set(a.status, (maps[target].status.get(a.status) ?? 0) + 1);
    const date = String(a.created_at ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_response");
    const day = maps[target].day.get(date) ?? { date, orderCount: 0, grossCents: 0, refundedCents: 0, netCents: 0 };
    day.orderCount += 1; day.grossCents += countedGross; day.refundedCents += countedRefund; day.netCents = day.grossCents - day.refundedCents; maps[target].day.set(date, day);
    const item = a.first_order_item;
    if (item && Number.isSafeInteger(Number(item.product_id)) && Number.isSafeInteger(Number(item.variant_id))) {
      const key = `${item.product_id}:${item.variant_id}`;
      const product = maps[target].product.get(key) ?? { productId: Number(item.product_id), variantId: Number(item.variant_id), productName: String(item.product_name ?? "Unknown"), variantName: String(item.variant_name ?? "Unknown"), orderCount: 0, grossCents: 0 };
      product.orderCount += 1; product.grossCents += countedGross; maps[target].product.set(key, product);
    }
  }
  for (const target of ["live", "test"]) {
    const slice = slices[target]; slice.netCents = slice.grossCents - slice.refundedCents;
    slice.byStatus = statuses.filter(status => maps[target].status.has(status)).map(status => ({ status, count: maps[target].status.get(status) }));
    slice.byDay = [...maps[target].day.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-366);
    slice.byProduct = [...maps[target].product.values()].sort((a, b) => b.grossCents - a.grossCents).slice(0, 100);
  }
  return { surface: "lemonsqueezy", observedAt: new Date(observedAt).toISOString(), status: complete ? "ok" : "partial", ...(complete ? {} : { errorCode: "incomplete_collection" }), data: { storeId: "100001", currency: "USD", complete, pageCount: currentPages.size, ...slices } };
}

export function aggregateLemonSqueezyResponses(items, observedAt = new Date().toISOString()) {
  const responses = items.map(item => item?.json ?? item);
  const errorCode = safeUpstreamError(responses);
  const empty = { storeId: "100001", currency: "USD", complete: false, pageCount: 0, live: emptySlice(), test: emptySlice() };
  if (errorCode) return { surface: "lemonsqueezy", observedAt: new Date(observedAt).toISOString(), status: "error", errorCode, data: empty };
  try { return aggregateLemonSqueezy(responses.map(response => unwrapResponse(response).body), observedAt); }
  catch { return { surface: "lemonsqueezy", observedAt: new Date(observedAt).toISOString(), status: "error", errorCode: "invalid_response", data: empty }; }
}

const pagination = {
  pagination: {
    paginationMode: "responseContainsNextURL",
    nextURL: "={{ (() => { const raw = $response.body?.links?.next; const initial = 'https://sales.dupdash.invalid/v1/orders'; if (!raw) return initial; const url = new URL(raw); if (url.protocol !== 'https:' || url.hostname !== 'sales.dupdash.invalid' || url.pathname !== '/v1/orders') throw Error('Lemon Squeezy returned an unexpected pagination URL'); if (url.searchParams.get('filter[store_id]') !== '100001') throw Error('Lemon Squeezy pagination dropped the store filter'); return url.toString(); })() }}",
    paginationCompleteWhen: "other", completeExpression: "={{ !$response.body?.links?.next }}",
    limitPagesFetched: true, maxRequests: 100,
  },
};
const projection = `const statuses = ${JSON.stringify(statuses)};\n${unwrapResponse.toString()}\n${safeUpstreamError.toString()}\n${emptySlice.toString()}\n${aggregateLemonSqueezy.toString()}\n${aggregateLemonSqueezyResponses.toString()}\nreturn [{json: aggregateLemonSqueezyResponses($input.all())}];`;
export const definition = workflow("DupdashLemonSqueezyOperational", "Dupdash — Lemon Squeezy operations (15 min)", [
  scheduleNode, manualNode,
  httpNode({ id: "orders", name: "Read all store orders", url: "https://sales.dupdash.invalid/v1/orders", credentialId: "DupdashLemonSqueezy", credentialName: "Dupdash Lemon Squeezy", position: [-620, 40], query: [{ name: "filter[store_id]", value: "100001" }, { name: "page[size]", value: "100" }, { name: "page[number]", value: "1" }], pagination }),
  codeNode("project", "Aggregate without customer data", projection, [-300, 40]), deliveryNode([0, 40]),
], {
  ...connectBoth("Read all store orders"),
  "Read all store orders": { main: [[{ node: "Aggregate without customer data", type: "main", index: 0 }]] },
  "Aggregate without customer data": { main: [[{ node: "Deliver operation observation", type: "main", index: 0 }]] },
});

if (process.argv.includes("--write")) writeFileSync(fileURLToPath(new URL("./operational-lemonsqueezy.json", import.meta.url)), `${JSON.stringify(definition, null, 2)}\n`);
