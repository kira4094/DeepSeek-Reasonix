import type { SlashHandler } from "../dispatch.js";

const mem: SlashHandler = () => ({
  info: "Session memory stored in ~/.reasonix/mem/sessions/",
});

export const handlers: Record<string, SlashHandler> = { mem };
