import { z } from "zod";

// Browser validators use the interpreter under the dashboard's nonce-only script policy.
z.config({ jitless: true });
