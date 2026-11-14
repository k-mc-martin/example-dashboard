import { isAbsolute } from "node:path";

const path = process.env.OPS_DASHBOARD_DATABASE_PATH;
if (!path || !isAbsolute(path)) throw new Error("OPS_DASHBOARD_DATABASE_PATH must be an absolute path.");
const { closeDb, getDb } = await import("../db/index.ts");
getDb();
closeDb();
console.log("Dashboard database schema is ready.");
