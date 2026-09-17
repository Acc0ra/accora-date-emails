const READ_PROPERTIES = ["email", "firstname", "date_email_last_sent", "hs_email_optout"];

// HubSpot's v3 API returns a plain "date" property (as opposed to
// datetime) as a string of epoch milliseconds at midnight UTC, e.g.
// "1735689600000" — not an ISO date string. new Date() on that string
// directly parses as Invalid Date, so numeric strings are detected and
// coerced first. Confirm this still holds when the hard-bounce property
// is confirmed, if it turns out to be date-typed rather than boolean/enum.
function parseHsDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const asNumber = Number(value);
  const d = Number.isFinite(asNumber) && /^-?\d+$/.test(String(value)) ? new Date(asNumber) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(todayIso, hsDateValue) {
  const then = parseHsDate(hsDateValue);
  if (!then) return Infinity;
  const today = new Date(`${todayIso}T00:00:00Z`);
  return Math.floor((today.getTime() - then.getTime()) / 86400000);
}

// Classifies each contact into exactly one bucket, in the priority order the
// brief lists them: permanent list, then the 60-day transient window, then
// opt-out, then hard bounce, then no email. A contact matching more than one
// reason is counted once, under whichever comes first — so the reason
// counts always sum to the total excluded.
function applyExclusions({
  contactIds,
  properties,
  exclusionListMemberIds,
  hardBounceProperty,
  transientWindowDays,
  todayIso,
}) {
  const excluded = {
    permanentList: [],
    recentlyEmailed: [],
    optedOut: [],
    hardBounced: [],
    noEmail: [],
  };
  const survivors = [];

  for (const id of contactIds) {
    const props = properties.get(id) || {};

    if (exclusionListMemberIds.has(id)) {
      excluded.permanentList.push(id);
      continue;
    }

    const lastSent = props.date_email_last_sent;
    if (lastSent && daysBetween(todayIso, lastSent) < transientWindowDays) {
      excluded.recentlyEmailed.push(id);
      continue;
    }

    if (String(props.hs_email_optout).toLowerCase() === "true") {
      excluded.optedOut.push(id);
      continue;
    }

    const bounceValue = props[hardBounceProperty];
    if (bounceValue && String(bounceValue).toLowerCase() !== "false") {
      excluded.hardBounced.push(id);
      continue;
    }

    if (!props.email) {
      excluded.noEmail.push(id);
      continue;
    }

    survivors.push(id);
  }

  return { survivors, excluded };
}

// Ascending by date_email_last_sent, nulls first — never-emailed contacts
// are the most overdue, and this is the mechanism that makes a held cohort
// self-correct next run without any extra bookkeeping.
function orderByLastSentAscendingNullsFirst(contactIds, properties) {
  return [...contactIds].sort((a, b) => {
    const da = parseHsDate(properties.get(a)?.date_email_last_sent);
    const db = parseHsDate(properties.get(b)?.date_email_last_sent);
    if (!da && !db) return 0;
    if (!da) return -1;
    if (!db) return 1;
    return da.getTime() - db.getTime();
  });
}

function splitAtCap(orderedIds, cap) {
  return {
    today: orderedIds.slice(0, cap),
    held: orderedIds.slice(cap),
  };
}

module.exports = {
  READ_PROPERTIES,
  applyExclusions,
  orderByLastSentAscendingNullsFirst,
  splitAtCap,
};
