export const channels = [
  { id: "beta", code: "BETA", name: "Beta responses" },
  { id: "purchases", code: "SALES", name: "Purchase notifications" },
  { id: "errors", code: "PRODUCT", name: "Product Errors" },
  { id: "infrastructure", code: "INFRA", name: "Infrastructure Errors" },
  { id: "support", code: "SUPPORT", name: "Support" },
  { id: "unsorted", code: "INBOX", name: "Unsorted" },
] as const;
export type Category = typeof channels[number]["id"];
export type Message = { id: string; sender: string; subject: string; body: string; receivedAt: string; category: Category; supportKind: string | null; sourceUrl: string | null };
export type ProviderKey = "cloudflare" | "lemonsqueezy" | "godaddy" | "azure";
export type ProviderConnection = { provider: ProviderKey; status: "verified"; identity: Record<string, unknown>; checkedAt: string };
export type ProviderConnections = Partial<Record<ProviderKey, ProviderConnection>>;
export const accounts = [
  { id: "mail", name: "SecDash email", identity: "contact@example.invalid", status: "Awaiting demo data", action: "Connection details", purpose: "Beta feedback, purchase notices, product errors, infrastructure errors and customer support.", url: null, setup: "Simulated messages are grouped by category." },
  { id: "n8n", name: "n8n", identity: "Private VPS automation", status: "Awaiting demo data", action: "Connection details", purpose: "Run provider integrations and deliver approved data to the dashboard.", url: null, setup: "Demo workflows deliver provider observations to this dashboard." },
  { id: "lemon", provider: "lemonsqueezy", name: "Lemon Squeezy", identity: "SecDash / ExampleApp", action: "Connection details", purpose: "Sales, orders and license activity.", url: null, setup: "Sales and refunds come from the demo store." },
  { id: "cloudflare", provider: "cloudflare", name: "Cloudflare", identity: "secdash-downloads / public + beta", action: "Connection details", purpose: "Installer storage, website deployments and usage.", url: null, setup: "Deployment and storage observations come from the demo edge provider." },
  { id: "azure", provider: "azure", name: "Microsoft Azure", identity: "demo-signing", action: "Connection details", purpose: "Windows artifact signing and account information.", url: null, setup: "The demo signing account supplies certificate and access information." },
  { id: "godaddy", provider: "godaddy", name: "GoDaddy", identity: "example.invalid", action: "Connection details", purpose: "Domain registration and renewal information.", url: null, setup: "The demo registrar supplies domain and renewal information." },
];
