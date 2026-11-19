import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Single-owner companion: exactly one row once the owner has claimed it. */
export const owner = pgTable("companion_owner", {
  id: integer("id").primaryKey().default(1),
  passphraseHash: text("passphrase_hash").notNull(),
  salt: text("salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Owner browser sessions. Only the SHA-256 of the cookie value is stored. */
export const ownerSessions = pgTable("companion_owner_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Meeting memory synced from the extension's exported `meetings/*.json` files. */
export const meetings = pgTable(
  "memory_meetings",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    durationSec: integer("duration_sec").notNull().default(0),
    summary: text("summary"),
    transcriptText: text("transcript_text").notNull().default(""),
    /** The complete Meeting record exactly as exported (memoryVersion included). */
    data: jsonb("data").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("memory_meetings_started_idx").on(t.startedAt)],
);

/** Revocable API credentials. The plaintext token is shown once and never stored. */
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  /** Subset of: memory:read, memory:sync */
  scopes: text("scopes").array().notNull().default(sql`ARRAY['memory:read']::text[]`),
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(60),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Every external call, for the owner's audit view and for rate limiting. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    tokenId: uuid("token_id"),
    action: text("action").notNull(),
    ok: boolean("ok").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_token_time_idx").on(t.tokenId, t.createdAt)],
);
