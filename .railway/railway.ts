import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const kavachVolume = volume("kavach-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 500 });
  const kavach = service("kavach", {
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    replicas: { "iad": 1 },
    volumeMounts: { "/data": kavachVolume },
    env: { KAVACH_CORS_ORIGINS: preserve(), KAVACH_DB: preserve(), KAVACH_DEMO: preserve(), KAVACH_MODE: preserve(), KAVACH_TRUST_PROXY: preserve(), RAZORPAY_KEY_ID: preserve(), RAZORPAY_KEY_SECRET: preserve() },
  });

  return project("kavach", {
    resources: [kavach, kavachVolume],
  });
});
