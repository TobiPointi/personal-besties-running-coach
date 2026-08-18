# Athelon coaching workspace

Private coach and athlete dashboards for goals, physiological tests, feedback,
versioned training plans, activity synchronization, and delivery history.

## Product behavior

- The first authorized visitor becomes the workspace coach.
- The coach can create athlete profiles and pending invitations.
- An invited email is linked to its athlete profile on first sign-in.
- Coaches see every assigned athlete; athletes see only their own published data.
- Generated plans are drafts until a coach publishes them.
- Publishing archives the prior version, creates an audit record, and queues a
  minimal email notification containing no physiological details.
- Intervals.icu uses per-athlete OAuth with read-only activity and wellness
  scopes. Access tokens are encrypted before D1 storage.
- Test source files are private R2 objects; structured stage observations remain
  in D1 for analysis.

## Local development

Requirements: Node.js 22.13+ and pnpm.

```powershell
pnpm install
pnpm run dev
pnpm run build
pnpm run db:generate
```

Local development uses a safe preview coach identity. Production relies on the
private Sites identity headers and server-side athlete assignments.

## Hosted configuration

Copy `.env.example` to `.env` only for local development. Hosted values belong
in the Sites environment-variable manager. Never commit actual credentials.

Intervals OAuth requires an application registered with Intervals.icu and these
values:

- `INTERVALS_CLIENT_ID`
- `INTERVALS_CLIENT_SECRET`
- `INTERVALS_REDIRECT_URI`
- `CONNECTION_ENCRYPTION_KEY` (a long random secret)

Optional automation:

- `COACH_ENGINE_URL`: deployed Python service from `../service/`
- `EMAIL_WEBHOOK_URL` and `EMAIL_WEBHOOK_TOKEN`: transactional email adapter
- `CRON_SECRET`: protects `/api/cron` for scheduled pipeline runs

Without optional values, the dashboard, manual data, plan drafting, publication,
calendar export, audit history, and queued outbox continue to work. OAuth and
external delivery show a clear setup state.

## Storage

`.openai/hosting.json` requests:

- D1 binding `DB` for users, assignments, tests, plans, feedback, jobs, and audit
  events.
- R2 binding `FILES` for private test reports and related uploads.

The runtime creates missing tables defensively, while `db/schema.ts` and the
generated Drizzle migration remain the canonical schema artifacts.

## Security boundaries

- Every API read and write checks the authenticated identity server-side.
- Athlete access is resolved through `coach_athletes` or the athlete's linked
  user ID; UI visibility is not treated as authorization.
- Physiological files are limited to PDF, PNG, JPEG, or CSV and 10 MB.
- Draft plans and private coach notes are never returned to athlete accounts.
- Intervals tokens are excluded from every dashboard query and audit payload.
- OAuth uses a short-lived, user-bound state value.

This application supports coaching decisions; it does not diagnose medical
conditions or replace appropriate professional assessment.
