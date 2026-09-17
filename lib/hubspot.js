// Thin HubSpot client. Every path here is indicative, not verified — confirm
// each shape against current HubSpot docs before this goes live (brief, API
// notes). Batches are capped at 100 per call per the brief; the MCP
// connector's 10-per-call write limit is a connector guardrail, not an API
// one, and doesn't apply here.

const BASE = "https://api.hubapi.com";
const BATCH_SIZE = 100;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

class HubspotError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function makeClient(token) {
  async function request(path, options = {}, attempt = 1) {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    if (res.status === 429 && attempt <= 4) {
      const waitMs = 500 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, waitMs));
      return request(path, options, attempt + 1);
    }

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (!res.ok) {
      throw new HubspotError(
        body.message || `HubSpot ${options.method || "GET"} ${path} failed (${res.status})`,
        res.status,
        body
      );
    }
    return body;
  }

  return {
    HubspotError,

    // Associations v4 batch read: company -> contact IDs.
    // Confirm exact path/shape before go-live.
    async getContactIdsForCompanies(companyIds) {
      const contactIds = new Set();
      for (const group of chunk(companyIds, BATCH_SIZE)) {
        const body = await request("/crm/v4/associations/companies/contacts/batch/read", {
          method: "POST",
          body: JSON.stringify({ inputs: group.map((id) => ({ id })) }),
        });
        for (const result of body.results || []) {
          for (const to of result.to || []) contactIds.add(String(to.toObjectId ?? to.id));
        }
      }
      return [...contactIds];
    },

    // Contacts batch read, 100 per call.
    async batchReadContacts(contactIds, properties) {
      const out = new Map();
      for (const group of chunk(contactIds, BATCH_SIZE)) {
        const body = await request("/crm/v3/objects/contacts/batch/read", {
          method: "POST",
          body: JSON.stringify({
            properties,
            inputs: group.map((id) => ({ id })),
          }),
        });
        for (const rec of body.results || []) {
          out.set(String(rec.id), rec.properties || {});
        }
      }
      return out;
    },

    // Contacts batch update, 100 per call. Returns per-batch outcome so the
    // caller can tell a real partial failure from a clean run — a batch that
    // half-writes must never look like a success.
    async batchUpdateContacts(updates) {
      const batches = chunk(updates, BATCH_SIZE);
      const results = [];
      for (const group of batches) {
        try {
          await request("/crm/v3/objects/contacts/batch/update", {
            method: "POST",
            body: JSON.stringify({
              inputs: group.map((u) => ({ id: u.id, properties: u.properties })),
            }),
          });
          results.push({ ok: true, contactIds: group.map((u) => u.id) });
        } catch (err) {
          results.push({ ok: false, contactIds: group.map((u) => u.id), error: err.message });
        }
      }
      return results;
    },

    // Lists v3 membership. The brief notes this list is stable, so reading
    // full membership once per run and holding it in memory is safe.
    // Confirm exact path before go-live.
    async getListMemberIds(listId) {
      const ids = new Set();
      let after;
      do {
        const qs = new URLSearchParams({ limit: "250", ...(after ? { after } : {}) });
        const body = await request(`/crm/v3/lists/${listId}/memberships?${qs}`);
        for (const rec of body.results || []) ids.add(String(rec.recordId ?? rec.id));
        after = body.paging?.next?.after;
      } while (after);
      return ids;
    },

    // Counts contacts with date_email_last_sent inside the given calendar
    // day (UTC). This is the daily-capacity proxy: no HubSpot endpoint
    // documents a remaining-allowance field (checked — sequences only
    // surface a "such-and-such left today" warning in the UI, not via API),
    // and reading HubSpot instead of the run log also catches sends made
    // outside this tool. Reset-mechanism (calendar day vs. rolling 24h, and
    // which timezone) is unconfirmed — see README — so this is a reasonable
    // proxy, not a guarantee.
    async countContactsSentToday(dateIso) {
      const startMs = Date.parse(`${dateIso}T00:00:00Z`);
      const endMs = startMs + 86400000 - 1;
      const body = await request("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: "date_email_last_sent", operator: "GTE", value: String(startMs) },
                { propertyName: "date_email_last_sent", operator: "LTE", value: String(endMs) },
              ],
            },
          ],
          limit: 1,
        }),
      });
      return typeof body.total === "number" ? body.total : 0;
    },

    // Company search, for the account picker. Limit kept small — this is a
    // typeahead, not a report.
    async searchCompanies(query, limit = 7) {
      const body = await request("/crm/v3/objects/companies/search", {
        method: "POST",
        body: JSON.stringify({
          query,
          properties: ["name"],
          limit,
        }),
      });
      return (body.results || []).map((r) => ({ id: String(r.id), name: r.properties?.name || "(no name)" }));
    },
  };
}

module.exports = { makeClient };
