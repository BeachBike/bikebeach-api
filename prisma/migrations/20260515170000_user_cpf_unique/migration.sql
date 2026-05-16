-- Enforce CPF uniqueness at the DB layer. Postgres treats multiple NULLs
-- as distinct in unique columns, so users without a CPF don't collide.
-- Existing prod data is expected to have no duplicates (low volume,
-- single-tenant launch); if a duplicate ever shows up this migration
-- fails with 23505 and we resolve manually before re-running.
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");
