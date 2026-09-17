// Simple file-backed store. Good enough for a small internal tool, but
// Render's local disk does not survive a redeploy unless a persistent Disk
// is attached to the service — attach one (or move this to a real DB)
// before relying on the run log across deploys. See README.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const LOG_FILE = path.join(DATA_DIR, "run-log.jsonl");

for (const dir of [DATA_DIR, RUNS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newRunId() {
  return crypto.randomUUID();
}

function runPath(id) {
  return path.join(RUNS_DIR, `${id}.json`);
}

function saveRun(run) {
  fs.writeFileSync(runPath(run.id), JSON.stringify(run, null, 2));
}

// id comes straight from the URL (req.params.id) — reject anything that
// isn't a UUID we generated ourselves before it ever touches the filesystem,
// rather than letting a crafted id walk the path.
function loadRun(id) {
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(runPath(id), "utf8"));
  } catch {
    return null;
  }
}

// Append-only audit log — the brief's non-negotiable "every run" record.
// Written once per run at the point counts are known, and again on
// completion/failure.
function appendLog(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

module.exports = { newRunId, saveRun, loadRun, appendLog };
