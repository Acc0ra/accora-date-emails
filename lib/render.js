// The four display strings. This is the only place that knows the grammar —
// server-side, because it's the only thing that knows how many specialists
// were named. Mirrored (not re-implemented differently) client-side for
// instant preview text; this module is the authority at write time.

function ordinal(day) {
  const v = day % 100;
  if (v >= 11 && v <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

function joinWithFinal(parts, finalWord) {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} ${finalWord} ${parts[parts.length - 1]}`;
}

// "Paul is" / "Paul and Phil are" / "Paul, Phil and Sam are"
function psName(names) {
  if (!names.length) throw new Error("At least one specialist name is required.");
  const verb = names.length === 1 ? "is" : "are";
  return `${joinWithFinal(names, "and")} ${verb}`;
}

// "Paul" / "Paul and Phil" / "Paul, Phil and Sam"
function psNamesPlain(names) {
  if (!names.length) throw new Error("At least one specialist name is required.");
  return joinWithFinal(names, "and");
}

// "the 18th, 23rd or 25th". Drops past dates against runDate, sorts
// ascending, takes the earliest 5. Throws if nothing survives — that's the
// hard failure the brief requires: refuse the run, write nothing.
function psDates(dates, runDateIso) {
  const future = [...new Set(dates)]
    .filter((d) => d >= runDateIso)
    .sort();
  if (future.length === 0) {
    const err = new Error(
      "Every date given is in the past (or none were given). Nothing to send — add at least one future date."
    );
    err.code = "NO_FUTURE_DATES";
    throw err;
  }
  const chosen = future.slice(0, 5);
  const ordinals = chosen.map((iso) => ordinal(Number(iso.slice(8, 10))));
  return `the ${joinWithFinal(ordinals, "or")}`;
}

// Territory is operator-typed free text; the em dash and year-month are
// composed here, out of the operator's hands, since that's where the format
// was most likely to drift. date_email_last_run is cohort identity for
// measurement only now — not a workflow trigger — so a spelling variant
// (e.g. "Manchester" vs "Greater Manchester") degrades reporting rather than
// breaking a send. Not fixed here; flagged in README.
function normalizeTerritory(territory) {
  const collapsed = String(territory || "").trim().replace(/\s+/g, " ");
  if (!collapsed) {
    throw new Error("Type the territory you're sending to.");
  }
  return collapsed
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function composeRunLabel(territory, runDateIso) {
  const yearMonth = runDateIso.slice(0, 7);
  return `${normalizeTerritory(territory)} — ${yearMonth}`;
}

function renderAll({ names, dates, territory, runDateIso }) {
  return {
    date_email_ps_name: psName(names),
    date_email_ps_names_plain: psNamesPlain(names),
    date_email_ps_dates: psDates(dates, runDateIso),
    date_email_last_run: composeRunLabel(territory, runDateIso),
  };
}

module.exports = { ordinal, psName, psNamesPlain, psDates, normalizeTerritory, composeRunLabel, renderAll };
