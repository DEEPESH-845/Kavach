import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const kavachVolume = volume("kavach-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 500 });
  const kavach = service("kavach", {
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    replicas: { "iad": 1 },
    volumeMounts: { "/data": kavachVolume },
    // preserve(): the dashboard's value is the source of truth and an apply never removes it.
    // Every variable Kavach reads is listed so a future apply cannot silently drop one.
    env: {
      KAVACH_CORS_ORIGINS: preserve(), KAVACH_DB: preserve(), KAVACH_DEMO: preserve(),
      KAVACH_MODE: preserve(), KAVACH_TRUST_PROXY: preserve(),
      RAZORPAY_KEY_ID: preserve(), RAZORPAY_KEY_SECRET: preserve(),
      RAZORPAY_WEBHOOK_SECRET: preserve(),
      KAVACH_AUTH: preserve(), KAVACH_METRICS_KEY: preserve(), KAVACH_POLICY: preserve(),
      KAVACH_PUBLIC_URL: preserve(), KAVACH_KILL_SWITCH: preserve(),
      KAVACH_WORKERS: preserve(), KAVACH_RECONCILE_INTERVAL: preserve(),
      KAVACH_LOG_FORMAT: preserve(), SENTRY_DSN: preserve(),
      OTEL_EXPORTER_OTLP_ENDPOINT: preserve(),
      KAVACH_SMTP_URL: preserve(), TWILIO_ACCOUNT_SID: preserve(), TWILIO_AUTH_TOKEN: preserve(),
      TWILIO_FROM_SMS: preserve(), TWILIO_FROM_WHATSAPP: preserve(),
      KAVACH_STEPUP_WEBHOOK_URL: preserve(), KAVACH_STEPUP_WEBHOOK_SECRET: preserve(),
    },
  });

  return project("kavach", {
    resources: [kavach, kavachVolume],
  });
});
