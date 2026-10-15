import type { Schedule } from "./types";
export function scheduleLabel(s: Schedule) {
  if (s.scheduleType !== "cron") return `Every ${s.intervalHours} hours`;
  const [minute, hour, day, month, weekday] = (s.cronExpression || "").split(" ");
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === "*" && month === "*") {
    const at = `${Number(hour) % 12 || 12}:${minute.padStart(2, "0")} ${Number(hour) < 12 ? "AM" : "PM"}`;
    if (weekday === "*") return `Daily at ${at} · ${s.timeZone}`;
    if (weekday === "1-5") return `Weekdays at ${at} · ${s.timeZone}`;
  }
  return `Calendar schedule · ${s.timeZone}`;
}
