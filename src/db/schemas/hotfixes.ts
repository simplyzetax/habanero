import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const HOTFIXES = sqliteTable("hotfixes", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    uniqueFilename: text("unique_filename").notNull(),
    filename: text("filename").notNull(),
    hash: text("hash").notNull(),
    hash256: text("hash256").notNull(),
    length: integer("length").notNull(),
    contents: text("contents").notNull(),
    scrapedAt: text("scraped_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
    index("idx_hotfixes_unique_filename").on(table.uniqueFilename),
    index("idx_hotfixes_filename").on(table.filename),
    index("idx_hotfixes_scraped_at").on(table.scrapedAt),
    index("idx_hotfixes_contents").on(table.contents),
]);

export type NewHotfix = typeof HOTFIXES.$inferInsert;
export type Hotfix = typeof HOTFIXES.$inferSelect;

export const insertHotfixSchema = z.object({
    id: z.string().optional(),
    uniqueFilename: z.string(),
    filename: z.string(),
    hash: z.string(),
    hash256: z.string(),
    length: z.number().int(),
    contentType: z.string(),
    uploaded: z.string(),
    storageType: z.string(),
    storageIds: z.object({ DSS: z.string() }),
    doNotCache: z.boolean(),
});