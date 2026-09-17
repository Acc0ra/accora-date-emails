# accora-date-emails

Resolves a cohort of HubSpot contacts and stamps four display-string
properties plus `date_email_queued = true`. It does **not** enrol contacts,
send email, or write `date_email_last_sent` or `date_email_queued = false` —
the `AJS_BulkDateEmails` HubSpot workflow does all three. See the build brief
for the full design rationale; this file covers setup, what's still open, and
how to run it safely.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in. Two values have no safe
   default and the service refuses to boot without them:
   - `HUBSPOT_TOKEN` — a private app token (not the browser-supplied token
     pattern used in `hubspot-geniu5`; Kelly should never handle a HubSpot
     token). Scopes: `crm.objects.companies.read`, `crm.objects.contacts.read`,
     `crm.objects.contacts.write`, `crm.lists.read`. No sequence scopes, no
     `crm.schemas.contacts.write`.
   - `EXCLUSION_LIST_ID` — the role-based permanent exclusion list's HubSpot
     list ID.
3. `npm start`, then open `http://localhost:10000`.

## What's still open (from the brief — resolve before a live run)

- **Hard-bounce property.** Defaulted to `hs_email_hard_bounce_reason` in
  `.env.example`. Confirm this is the right property on portal 25005558 —
  set `HUBSPOT_HARD_BOUNCE_PROPERTY` if not.
- **Every HubSpot endpoint shape** in `lib/hubspot.js` is marked indicative in
  a comment, per the brief. Confirm associations v4 batch read, contacts
  batch read/update, and list membership against current docs before the
  first live run — these are the calls a schema change would silently break.
- **60-day transient window.** `TRANSIENT_WINDOW_DAYS` — brief flags this as
  worth revisiting against the ~20-patch monthly specialist rotation.
- **VIP semantics.** Not wired into any exclusion — the four `vip_*`
  properties are ambiguous (high-spend customer vs. ACM-managed account) and
  the brief says not to exclude on them until that's settled.
- **Re-enrolment on false → true**, and **"date of step execution" being
  settable** on a date property — both are properties of the
  `AJS_BulkDateEmails` workflow itself, not this service. Confirm with the
  workflow's Test tool; nothing here depends on the outcome except that the
  whole design assumes both hold.

## Running it safely (first time and every time)

- **Dry run first.** "Try it without sending" on the operator UI calls
  `/api/run/preview` and stops — it resolves, excludes, orders and renders,
  and shows the full report, but writes nothing. Run this against a real but
  small/known-safe account selection before the first live send, per the
  brief's non-negotiable and standard practice for any first-time write path
  against live HubSpot data.
- **Partial batch failures don't hide.** If a batch of 100 fails outright,
  those contacts are reported by name count in the run report and never got
  `date_email_queued = true` — running the same account selection again picks
  them up automatically, because their `date_email_last_sent` never changed
  and the ordering (oldest-first, nulls first) puts them at the front.
- **Held contacts need no special handling.** Overflow above the cap is
  simply never written. Run the same accounts again next time; the ordering
  does the rest.

## Persistence

Runs and the audit log live in `data/` as plain JSON/JSONL files — good
enough for a small internal tool, but **Render's local disk does not survive
a redeploy** unless a persistent Disk is attached to the service. Attach one
before relying on `data/run-log.jsonl` across deploys, or move `lib/store.js`
to a real database if that log needs to survive indefinitely.

## Alerting

Set `ALERT_WEBHOOK_URL` to a Slack incoming webhook (or anything that accepts
`{"text": "..."}`) to get a message on batch-write failure. Optional — the
run report surfaces failures loudly either way.

## What's deliberately not built here

- No sending, no sequence enrolment, no `date_email_last_sent` writes — see
  "What this is" in the build brief for why that boundary matters.
- No saved account selections / rota store — the brief is explicit that none
  exists on this portal and none is planned; specialist names and dates are
  typed fresh each run.
- No account picker restriction by territory — there's no territory property
  on this portal. Getting the right accounts for the right specialists is a
  human judgement call at the confirm step, not something the service can
  validate.
