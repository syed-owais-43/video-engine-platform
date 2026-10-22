import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  googleId: text("google_id").unique(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  // Admin-granted free access, independent of Stripe.
  compAccess: boolean("comp_access").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id").unique(),
  // Voice for the user's videos: Voicebox runs free on their PC; ElevenLabs uses their own key
  // (encrypted with APP_SECRET, never sent to their AI: the site calls ElevenLabs for them).
  voiceProvider: text("voice_provider", { enum: ["voicebox", "elevenlabs"] }).notNull().default("voicebox"),
  elevenlabsKey: text("elevenlabs_key"),
  // Version of the computer-setup checklist the user's AI last confirmed (see lib/setup-checklist.ts).
  setupVersion: integer("setup_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Subscription plans are data, not code, so tiers can be changed from the admin panel.
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Monthly price; the admin panel creates the matching Stripe product/price from it.
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id").unique(),
  // Earlier Stripe prices of this plan; existing subscribers stay on them after a price change.
  legacyPriceIds: jsonb("legacy_price_ids").$type<string[]>().notNull().default([]),
  priceLabel: text("price_label").notNull(), // e.g. "$29 / month"
  commercialUse: boolean("commercial_use").notNull().default(true),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
});

// Admin-managed configuration (brand, Stripe, Google). Values are encrypted.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(), // Stripe subscription id
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    priceId: text("price_id").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId)],
);

export const engines = pgTable("engines", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  published: boolean("published").notNull().default(false),
  currentVersionId: uuid("current_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const engineVersions = pgTable(
  "engine_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineId: uuid("engine_id").notNull().references(() => engines.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    notes: text("notes").notNull().default(""),
    fileCount: integer("file_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("engine_versions_engine_version_idx").on(t.engineId, t.version)],
);

// "remote" files (SKILL.md, reference/**) are only ever served live through MCP.
// "local" files (scripts, templates, licence) go into the downloadable bundle.
export const engineFiles = pgTable(
  "engine_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => engineVersions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: text("kind", { enum: ["remote", "local"] }).notNull(),
    data: text("data").notNull(), // base64
    size: integer("size").notNull(),
  },
  (t) => [uniqueIndex("engine_files_version_path_idx").on(t.versionId, t.path)],
);

// Style library, inspiration library and resource packs. Each item is uploaded as a ZIP from the
// admin panel. Styles and references are unpacked into library_files (Claude reads their text and
// still frames through MCP); a resource pack is kept as one ZIP that the Companion installs locally.
export const libraryItems = pgTable(
  "library_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["style", "ref", "pack"] }).notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    published: boolean("published").notNull().default(false),
    // Packs: bumped on every upload so the Companion knows to download again.
    version: integer("version").notNull().default(1),
    // style.json for styles; { category } for packs.
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    // recipe.md (styles) or breakdown.md (references).
    notes: text("notes").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("library_items_kind_slug_idx").on(t.kind, t.slug)],
);

// One file of a library item. Stored in Vercel Blob when the site has a Blob store (url), otherwise
// in the database itself (data, base64), which is fine for local testing and small items.
export const libraryFiles = pgTable(
  "library_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => libraryItems.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    url: text("url"),
    data: text("data"),
  },
  (t) => [uniqueIndex("library_files_item_path_idx").on(t.itemId, t.path)],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const oauthTokens = pgTable("oauth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    engineId: uuid("engine_id").references(() => engines.id, { onDelete: "set null" }),
    tool: text("tool").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_user_time_idx").on(t.userId, t.createdAt), index("usage_time_idx").on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Engine = typeof engines.$inferSelect;
export type LibraryItem = typeof libraryItems.$inferSelect;
export type LibraryFile = typeof libraryFiles.$inferSelect;
