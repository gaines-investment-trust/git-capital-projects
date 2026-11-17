import { z } from "zod";

/**
 * All settings come from environment variables. In Azure they are injected
 * from Key Vault references; nothing secret lives in the repository.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.string().optional().transform((v) => v === "1" || v === "true"),

  // Microsoft Entra ID (staff sign-in)
  AUTH_SECRET: z.string().min(16),
  AUTH_MICROSOFT_ENTRA_ID_ID: z.string().optional(),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().optional(),
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: z.string().optional(),
  /** Local development only: enables a no-password sign-in as a seeded user. Never set in Azure. */
  AUTH_DEV_LOGIN: z.string().optional().transform((v) => v === "1"),
  /** First executive + admin; created on first sign-in if the people table is empty. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("joeg@gainesinvestmenttrust.com"),

  // Document store: "graph" in Azure, "local" for development and tests
  DOCSTORE: z.enum(["graph", "local"]).default("local"),
  LOCAL_DOCSTORE_DIR: z.string().default(".data/sharepoint"),
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  /** Omit in Azure: the app then uses its managed identity / workload identity. */
  GRAPH_CLIENT_SECRET: z.string().optional(),
  SP_SITE_ID: z.string().optional(),
  SP_DRIVE_ID: z.string().optional(),
  SP_ROOT_ITEM_ID: z.string().optional(),

  APP_BASE_URL: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
