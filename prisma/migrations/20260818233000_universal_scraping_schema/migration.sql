-- Raw SQL migration for GIN and expression indexes not supported natively by Prisma 5.7.x
-- Apply with: npx prisma migrate deploy

CREATE INDEX IF NOT EXISTS idx_post_metadata_gin ON "Post" USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_comment_metadata_gin ON "Comment" USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_post_metadata_price ON "Post" USING btree ((metadata->>'price'));
CREATE INDEX IF NOT EXISTS idx_post_metadata_phone ON "Post" USING btree ((metadata->>'phone'));
CREATE INDEX IF NOT EXISTS idx_post_metadata_salary ON "Post" USING btree ((metadata->>'salary'));

CREATE INDEX IF NOT EXISTS idx_post_crawled_at ON "Post" USING btree ("crawledAt");
CREATE INDEX IF NOT EXISTS idx_comment_crawled_at ON "Comment" USING btree ("crawledAt");

-- Note: Prisma may not reflect these raw indexes in the schema. Do not run `prisma db pull`
-- after applying this migration, as it will drop the `USING gin` clause.
