export const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: true,
  severities: ["critical", "high", "medium", "low"],
  dimensions: ["fraud", "mule_network", "aml"],
  quiet_hours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: "Asia/Vientiane",
  },
};
export const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).sort().join() === keys.sort().join();
export function validNotificationPreferences(v: unknown) {
  if (
    !object(v) ||
    !exact(v, ["enabled", "severities", "dimensions", "quiet_hours"]) ||
    typeof v.enabled !== "boolean"
  )
    return false;
  for (const [key, allowed] of [
    ["severities", ["critical", "high", "medium", "low"]],
    ["dimensions", ["fraud", "mule_network", "aml"]],
  ] as const) {
    const a = v[key];
    if (
      !Array.isArray(a) ||
      a.length > allowed.length ||
      new Set(a).size !== a.length ||
      a.some((s) => !allowed.includes(s as never))
    )
      return false;
  }
  const q = v.quiet_hours;
  return (
    object(q) &&
    exact(q, ["enabled", "start", "end", "timezone"]) &&
    typeof q.enabled === "boolean" &&
    ["start", "end"].every(
      (k) =>
        typeof q[k] === "string" &&
        /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(q[k] as string),
    ) &&
    ["Asia/Vientiane", "UTC"].includes(String(q.timezone))
  );
}
