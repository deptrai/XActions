-- Raw SQL migration for GIN and expression indexes not supported natively by Prisma 5.7.x
-- Apply with: npx prisma migrate deploy
--
-- Guarded by to_regclass() so the migration replays cleanly on a fresh shadow
-- database: "Post"/"Comment" are created outside migrations (db push era), so
-- they do not exist when this file is replayed from scratch.

DO $$
BEGIN
    IF to_regclass('public."Post"') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_post_metadata_gin ON "Post" USING gin (metadata);
        CREATE INDEX IF NOT EXISTS idx_post_metadata_price ON "Post" USING btree ((metadata->>'price'));
        CREATE INDEX IF NOT EXISTS idx_post_metadata_phone ON "Post" USING btree ((metadata->>'phone'));
        CREATE INDEX IF NOT EXISTS idx_post_metadata_salary ON "Post" USING btree ((metadata->>'salary'));
    END IF;

    IF to_regclass('public."Comment"') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_comment_metadata_gin ON "Comment" USING gin (metadata);
    END IF;
END $$;

-- Note: Prisma may not reflect these raw indexes in the schema. Do not run `prisma db pull`
-- after applying this migration, as it will drop the `USING gin` clause.
