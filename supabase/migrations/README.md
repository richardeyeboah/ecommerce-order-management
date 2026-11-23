# Database migrations

For a new project, apply `../bootstrap.sql` once, then apply every migration in
`manifest.json` order. Existing projects apply only manifest versions that are
not present in `public.schema_migrations`.

Commerce deploy order:

1. Apply pending SQL to the staging database.
2. Run `npm run verify:migrations`.
3. Run checkout/payment/refund integration tests in Stripe test mode.
4. Apply the same versions to production before deploying code that depends on them.

Do not use the older loose SQL files as an alternative migration path. They are
retained as historical feature scripts for existing installations.
