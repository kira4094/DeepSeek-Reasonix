import { execSync } from "node:child_process";
import type { SlashHandler } from "../dispatch.js";

const mem: SlashHandler = (_args, _loop, _ctx) => {
  try {
    const dashboardUrl = process.env.REASONIX_DASHBOARD_URL;
    if (dashboardUrl) {
      // dashboardUrl is like "http://127.0.0.1:9264/?token=abc"
      // We want "http://127.0.0.1:9264/mem?token=abc"
      const base = dashboardUrl.split("?")[0].replace(/\/$/, "");
      const token = dashboardUrl.includes("?") ? "?" + dashboardUrl.split("?")[1] : "";
      const memUrl = base + "/mem" + token;
      execSync(`start "" "${memUrl}"`, { timeout: 3000, windowsHide: true });
      return { info: `Opening memory browser: ${memUrl}` };
    }
  } catch { /* non-fatal */ }

  return { info: "Memory browser available at /mem on the dashboard URL. Use /dashboard for the URL." };
};

export const handlers: Record<string, SlashHandler> = { mem };
