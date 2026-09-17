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
     pattern used in `hubspot-geniu5`; Apple should never handle a HubSpot
     token). Scopes: `crm.objects.companies.read`, `crm.objects.contacts.read`,
     `crm.objects.contacts.write`, `crm.lists.read`. No sequence scopes, no
     `crm.schemas.contacts.write`.
   - `EXCLUSION_LIST_ID` — the role-based permanent exclusion list's HubSpot
     list ID.
3. `npm start`, then open `http://localhost:10000`.

## Specialist roster

`lib/specialists.js` is a static, hand-edited list grouped by region (North,
Midlands, South Coast, South East). Region is a display grouping only — it
does not filter or suggest accounts in section 1; there's no territory
property or region-to-account mapping on this portal.

Selection order (not the roster's listing order, not alphabetical) drives the
rendered string: picking Paul then Phil renders `Paul and Phil are`. Two
selected specialists who share a first name (there are two Joshes and two
Marks in the current list) both render as first name plus surname initial —
`Josh W and Josh M are` — resolved per-run against whoever is actually
selected together, not pre-flagged in the config. A third, non-colliding
name in the same selection keeps its plain first name.

To add, remove or rename a specialist, edit the `ROSTER` array in
`lib/specialists.js` directly — no HubSpot lookup involved.

## Territory field

Section 4 takes a bare territory (`Manchester`), not the full run label. The
service normalises it (trim, collapse whitespace, capitalise each word) and
composes `Territory — YYYY-MM` at run time — the em dash and year-month never
pass through the operator's hands, which is where the format was most likely
to drift.

`date_email_last_run` is cohort identity for measurement only, **not** a
workflow trigger (`date_email_queued` is the trigger) — so a spelling variant
(`Manchester` vs. `Greater Manchester`) degrades reporting rather than
breaking a send. Two sends to the same territory in the same month also
collapse into one cohort for measurement. Both are flagged, not fixed —
low stakes while the label is internal.

## Daily capacity counter

The "This send" slip shows `{sentToday} sent through this tool today.
{remainingToday} remaining.`, derived from a live HubSpot count of contacts
with `date_email_last_sent` in today's UTC calendar day — not from the run
log (see Persistence below) and not from a HubSpot quota field (checked: no
such field is documented on the sequences API, only a UI-side warning
banner). It's informational only and doesn't change how many get queued in a
run — `SEND_CAP` still gates that. It can under-report headroom, never
over-report it. No countdown timer: whether the cap resets on a calendar day
or a rolling 24 hours, and in which timezone, is unconfirmed.

## What's still open (from the brief — resolve before a live run)

- **Hard-bounce property.** Defaulted to `hs_email_hard_bounce_reason` in
  `.env.example`. Confirm this is the right property on portal 25005558 —
  set `HUBSPOT_HARD_BOUNCE_PROPERTY` if not.
- **Every HubSpot endpoint shape** in `lib/hubspot.js` is marked indicative in
  a comment, per the brief. Confirm associations v4 batch read, contacts
  batch read/update, list membership, and the contacts search used for the
  capacity counter against current docs before the first live run — these are
  the calls a schema change would silently break.
- **60-day transient window.** `TRANSIENT_WINDOW_DAYS` — brief flags this as
  worth revisiting against the ~20-patch monthly specialist rotation.
- **Cap reset mechanism.** Calendar day vs. rolling 24 hours, and which
  timezone — blocks a countdown timer, nothing else.
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

## Persistence — treat it as best-effort

Runs and the audit log live in `data/` as plain JSON/JSONL files. On Render's
free tier this is genuinely ephemeral: wiped on every restart, redeploy, and
spin-down, and free services spin down after roughly 15 minutes idle. The log
will be empty most mornings — that's routine, not a fault.

Nothing here depends on it surviving:

- The daily capacity counter reads live from HubSpot, not the log, for
  exactly this reason (it also catches sends made outside this tool, which
  the log never could).
- The held-set resume doesn't need it either — re-running the same account
  selection returns the held contacts anyway, because everyone already
  stamped falls out on the transient-window exclusion, and the operator
  retypes dates each run so the past-date filter handles staleness.
- If a run's own record is wiped mid-flight (a redeploy during a send, or the
  operator returning after a spin-down), the UI shows a calm empty state —
  "this run's progress didn't survive" — never a raw error. Check HubSpot
  directly if unsure whether a run actually completed.

Attach a persistent Disk to the Render service (or move `lib/store.js` to a
real database) if the audit log ever needs to survive across deploys.

## Alerting

Set `ALERT_WEBHOOK_URL` to a Slack incoming webhook (or anything that accepts
`{"text": "..."}`) to get a message on batch-write failure. Optional — the
run report surfaces failures loudly either way.

## What's deliberately not built here

- No sending, no sequence enrolment, no `date_email_last_sent` writes — see
  "What this is" in the build brief for why that boundary matters.
- No saved account selections / rota store — the brief is explicit that none
  exists on this portal and none is planned; dates are picked fresh each run,
  and the specialist roster is a static hand-edited list, not per-run input.
- No account picker restriction by territory — there's no territory property
  on this portal. Getting the right accounts for the right specialists is a
  human judgement call at the confirm step, not something the service can
  validate.
