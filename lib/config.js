// Central place for env vars. Fails loudly at boot (not mid-run) if anything
// required is missing — Apple should never see a config error mid-send.

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}. Check .env against .env.example.`);
  return v;
}

const config = {
  port: Number(process.env.PORT) || 10000,
  hubspotToken: requireEnv("HUBSPOT_TOKEN"),
  hubspotPortalId: process.env.HUBSPOT_PORTAL_ID || "",
  exclusionListId: requireEnv("EXCLUSION_LIST_ID"),
  hardBounceProperty: process.env.HUBSPOT_HARD_BOUNCE_PROPERTY || "hs_email_hard_bounce_reason",
  transientWindowDays: Number(process.env.TRANSIENT_WINDOW_DAYS) || 60,
  sendCap: Number(process.env.SEND_CAP) || 1000,
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "",
};

module.exports = config;
