const express = require("express");
const cors = require("cors");
const path = require("path");

const config = require("./lib/config");
const { makeClient } = require("./lib/hubspot");
const render = require("./lib/render");
const pipeline = require("./lib/pipeline");
const store = require("./lib/store");

const hubspot = makeClient(config.hubspotToken);
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => handleError(res, err));
}

// Readable errors only — Kelly runs this, a stack trace is a dead end for
// her. The server console gets the message and stack, never a raw HubSpot
// response body (those can carry contact PII — see devops-assistant skill).
function handleError(res, err) {
  console.error(err.stack || err.message);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 400;
  res.status(status).json({
    error: err.userMessage || err.message || "Something went wrong. Try again, and if it keeps happening, ask Fred Marsh or the AI Steering Committee.",
  });
}

async function sendAlert(message) {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (err) {
    console.error("Alert webhook failed:", err.message);
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────────────────
// Companies (account picker)
// ────────────────────────────────────────────────────────────────────────

app.get(
  "/api/companies/search",
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ results: [] });
    const results = await hubspot.searchCompanies(q, 10);
    res.json({ results });
  })
);

// ────────────────────────────────────────────────────────────────────────
// Preview — resolve, exclude, order, render, report. Never writes.
// This IS the dry run: "Try it without sending" calls this and stops.
// ────────────────────────────────────────────────────────────────────────

app.post(
  "/api/run/preview",
  asyncRoute(async (req, res) => {
    const { companyIds, names, dates, runLabel, cap } = req.body || {};

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      const e = new Error("Pick at least one account.");
      throw e;
    }
    const cleanNames = (names || []).map((n) => String(n).trim()).filter(Boolean);
    if (cleanNames.length < 1 || cleanNames.length > 3) {
      throw new Error("Name 1 to 3 specialists.");
    }
    const cleanDates = (dates || []).map((d) => String(d).trim()).filter(Boolean);
    if (cleanDates.length === 0) {
      throw new Error("Add at least one date.");
    }
    const effectiveCap = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : config.sendCap;
    const runDate = todayIso();

    // Render first — the past-date hard failure must stop the run before
    // any HubSpot calls, per the brief, and costs nothing to check early.
    const renderedStrings = render.renderAll({ names: cleanNames, dates: cleanDates, runLabel, runDateIso: runDate });
    const warning = render.emDashWarning(runLabel);

    const [rawContactIds, exclusionListMemberIds] = await Promise.all([
      hubspot.getContactIdsForCompanies(companyIds),
      hubspot.getListMemberIds(config.exclusionListId),
    ]);

    const properties = await hubspot.batchReadContacts(rawContactIds, [
      ...pipeline.READ_PROPERTIES,
      config.hardBounceProperty,
    ]);

    const { survivors, excluded } = pipeline.applyExclusions({
      contactIds: rawContactIds,
      properties,
      exclusionListMemberIds,
      hardBounceProperty: config.hardBounceProperty,
      transientWindowDays: config.transientWindowDays,
      todayIso: runDate,
    });

    const ordered = pipeline.orderByLastSentAscendingNullsFirst(survivors, properties);
    const { today, held } = pipeline.splitAtCap(ordered, effectiveCap);

    const sampleId = today.find((id) => properties.get(id)?.email);
    const sampleProps = sampleId ? properties.get(sampleId) : null;

    const run = {
      id: store.newRunId(),
      createdAt: new Date().toISOString(),
      runDate,
      companyIds,
      names: cleanNames,
      dates: cleanDates,
      runLabel,
      cap: effectiveCap,
      status: "previewed",
      counts: {
        raw: rawContactIds.length,
        excluded: {
          permanentList: excluded.permanentList.length,
          recentlyEmailed: excluded.recentlyEmailed.length,
          optedOut: excluded.optedOut.length,
          hardBounced: excluded.hardBounced.length,
          noEmail: excluded.noEmail.length,
        },
        resolved: survivors.length,
        willWriteToday: today.length,
        heldForNextTime: held.length,
      },
      todayContactIds: today,
      heldContactIds: held,
      renderedStrings,
      sample: sampleProps ? { firstname: sampleProps.firstname || "", email: sampleProps.email } : null,
      writtenCount: 0,
      failedContactIds: [],
      log: [{ ts: new Date().toISOString(), message: "Previewed — nothing written yet." }],
    };
    store.saveRun(run);
    store.appendLog({
      stage: "previewed",
      runId: run.id,
      companyIds,
      names: cleanNames,
      dates: cleanDates,
      runLabel,
      counts: run.counts,
    });

    res.json({
      runId: run.id,
      counts: run.counts,
      renderedStrings,
      sample: run.sample,
      warning,
    });
  })
);

// ────────────────────────────────────────────────────────────────────────
// Execute — the only step that writes. Batches of 100, tracked so a
// partial failure is visible and the run stays re-runnable.
// ────────────────────────────────────────────────────────────────────────

app.post(
  "/api/run/:id/execute",
  asyncRoute(async (req, res) => {
    const run = store.loadRun(req.params.id);
    if (!run) throw new Error("That run wasn't found — it may have expired. Start again from Compose.");
    if (run.status !== "previewed") {
      return res.json({ runId: run.id, status: run.status });
    }

    const operator = String((req.body || {}).operator || "unknown").trim() || "unknown";
    run.operator = operator;
    run.status = "writing";
    run.log.push({ ts: new Date().toISOString(), message: `Queuing started by ${operator}.` });
    store.saveRun(run);

    res.json({ runId: run.id, status: "writing" });

    processRun(run.id).catch((err) => console.error(`processRun(${run.id}) crashed:`, err.stack || err.message));
  })
);

async function processRun(runId) {
  const run = store.loadRun(runId);
  if (!run) return;

  const chunkSize = 100;
  const contactIds = run.todayContactIds;

  for (let i = 0; i < contactIds.length; i += chunkSize) {
    const group = contactIds.slice(i, i + chunkSize);
    const updates = group.map((id) => ({
      id,
      properties: {
        date_email_ps_name: run.renderedStrings.date_email_ps_name,
        date_email_ps_names_plain: run.renderedStrings.date_email_ps_names_plain,
        date_email_ps_dates: run.renderedStrings.date_email_ps_dates,
        date_email_last_run: run.renderedStrings.date_email_last_run,
        date_email_queued: "true",
      },
    }));

    const results = await hubspot.batchUpdateContacts(updates);
    for (const r of results) {
      if (r.ok) {
        run.writtenCount += r.contactIds.length;
        run.log.push({
          ts: new Date().toISOString(),
          message: `Queued ${run.writtenCount} of ${contactIds.length}.`,
        });
      } else {
        run.failedContactIds.push(...r.contactIds);
        run.log.push({
          ts: new Date().toISOString(),
          message: `${r.contactIds.length} contacts did not get queued (${r.error}). This run stays re-runnable for just those people.`,
        });
      }
    }
    store.saveRun(run);
  }

  run.status = run.failedContactIds.length > 0 ? "done-with-failures" : "done";
  run.log.push({
    ts: new Date().toISOString(),
    message:
      run.status === "done"
        ? `Finished. ${run.writtenCount} queued, ${run.counts.heldForNextTime} held for next time.`
        : `Finished with ${run.failedContactIds.length} not queued. ${run.writtenCount} queued, ${run.counts.heldForNextTime} held for next time.`,
  });
  store.saveRun(run);

  store.appendLog({
    stage: run.status,
    runId: run.id,
    operator: run.operator,
    companyIds: run.companyIds,
    names: run.names,
    dates: run.dates,
    runLabel: run.runLabel,
    written: run.writtenCount,
    held: run.counts.heldForNextTime,
    failed: run.failedContactIds.length,
  });

  if (run.failedContactIds.length > 0) {
    await sendAlert(
      `[accora-date-emails] Run ${run.id} (${run.runLabel}): ${run.failedContactIds.length} contacts did not get queued. Re-run the same accounts to pick them up.`
    );
  }
}

// ────────────────────────────────────────────────────────────────────────
// Status / report — polled by the sending and report views.
// ────────────────────────────────────────────────────────────────────────

app.get(
  "/api/run/:id/status",
  asyncRoute(async (req, res) => {
    const run = store.loadRun(req.params.id);
    if (!run) throw new Error("That run wasn't found — it may have expired.");
    res.json({
      runId: run.id,
      status: run.status,
      runLabel: run.runLabel,
      names: run.names,
      dates: run.dates,
      renderedStrings: run.renderedStrings,
      counts: run.counts,
      writtenCount: run.writtenCount,
      failedCount: run.failedContactIds.length,
      log: run.log.slice(-20),
    });
  })
);

app.get("/api/config", (req, res) => res.json({ sendCap: config.sendCap }));

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`accora-date-emails listening on ${config.port}`);
});
