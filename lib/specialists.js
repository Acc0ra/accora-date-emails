// Static roster. Edited by hand — no HubSpot lookup, no territory link.
// Region is a display grouping only; it does not filter or suggest accounts
// in section 1 (there's no territory property on this portal, and none is
// planned).

const ROSTER = [
  { id: "steven-friel", region: "North", fullName: "Steven Friel" },
  { id: "jason-edmondson", region: "North", fullName: "Jason Edmondson" },
  { id: "josh-watson", region: "North", fullName: "Josh Watson" },
  { id: "paul-marsland", region: "North", fullName: "Paul Marsland" },
  { id: "phil-freestone", region: "North", fullName: "Phil Freestone" },

  { id: "mark-hodges", region: "Midlands", fullName: "Mark Hodges" },
  { id: "dan-patterson", region: "Midlands", fullName: "Dan Patterson" },
  { id: "james-patterson", region: "Midlands", fullName: "James Patterson" },
  { id: "chris-smith", region: "Midlands", fullName: "Chris Smith" },
  { id: "sam-franklin", region: "Midlands", fullName: "Sam Franklin" },

  { id: "olly-wadden", region: "South Coast", fullName: "Olly Wadden" },
  { id: "joe-green", region: "South Coast", fullName: "Joe Green" },
  { id: "josh-morgan", region: "South Coast", fullName: "Josh Morgan" },
  { id: "tom-waplington", region: "South Coast", fullName: "Tom Waplington" },

  { id: "tino-paphitis", region: "South East", fullName: "Tino Paphitis" },
  { id: "dean-cooper", region: "South East", fullName: "Dean Cooper" },
  { id: "mark-edwards", region: "South East", fullName: "Mark Edwards" },
  { id: "jamie-goodman", region: "South East", fullName: "Jamie Goodman" },
];

const REGION_ORDER = ["North", "Midlands", "South Coast", "South East"];

// Display name defaults to first name. A second field, kept separate from
// fullName, in case a future entry needs a name that isn't just "first
// word of fullName" (a nickname, say).
function firstName(fullName) {
  return fullName.split(/\s+/)[0];
}

function surnameInitial(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1][0].toUpperCase();
}

const BY_ID = new Map(ROSTER.map((s) => [s.id, { ...s, displayName: firstName(s.fullName) }]));

function listGroupedByRegion() {
  return REGION_ORDER.map((region) => ({
    region,
    specialists: ROSTER.filter((s) => s.region === region).map((s) => ({
      id: s.id,
      fullName: s.fullName,
      displayName: firstName(s.fullName),
    })),
  }));
}

// Resolves 1-3 selected ids, in selection order, to the strings that go into
// the rendered email. Two selected specialists sharing a first name both
// get "First S" (surname initial); a third, non-colliding one keeps their
// plain first name. Order in == order out — selection order drives the
// rendered string, never alphabetical.
function resolveDisplayNames(ids) {
  const chosen = ids.map((id) => {
    const s = BY_ID.get(id);
    if (!s) {
      const err = new Error(`Unknown specialist selected (${id}). Refresh and pick again.`);
      err.status = 400;
      throw err;
    }
    return s;
  });

  const counts = new Map();
  for (const s of chosen) counts.set(s.displayName, (counts.get(s.displayName) || 0) + 1);

  return chosen.map((s) => (counts.get(s.displayName) > 1 ? `${s.displayName} ${surnameInitial(s.fullName)}` : s.displayName));
}

module.exports = { listGroupedByRegion, resolveDisplayNames, firstName, surnameInitial };
