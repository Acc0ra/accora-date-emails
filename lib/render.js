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

function lastRun(runLabel) {
  if (!runLabel || !runLabel.trim()) {
    throw new Error("Run label is required — it's the exact string the workflow trigger matches on.");
  }
  return runLabel;
}

// Non-blocking check: the workflow trigger matches this string exactly, and
// a plain hyphen instead of an em dash is the classic silent-failure mode.
function emDashWarning(runLabel) {
  if (/\s-\s/.test(runLabel) && !runLabel.includes("—")) {
    return 'This looks like it uses a plain hyphen ("-") rather than an em dash ("—"). ' +
      "If the workflow trigger expects an em dash, this run label won't match it.";
  }
  return null;
}

function renderAll({ names, dates, runLabel, runDateIso }) {
  return {
    date_email_ps_name: psName(names),
    date_email_ps_names_plain: psNamesPlain(names),
    date_email_ps_dates: psDates(dates, runDateIso),
    date_email_last_run: lastRun(runLabel),
  };
}

module.exports = { ordinal, psName, psNamesPlain, psDates, lastRun, emDashWarning, renderAll };
