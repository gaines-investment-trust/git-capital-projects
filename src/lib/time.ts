/** GIT works in Pacific time. These convert form values (no zone) to and from stored UTC instants. */
const TZ = "America/Los_Angeles";

function offsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs))
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - utcMs) / 60000;
}

/** "2027-01-22T14:00" entered in Pacific time -> ISO UTC instant. Handles PST/PDT. */
export function pacificToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Not a date and time: ${local}`);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = naive - offsetMinutes(naive) * 60000;
  utc = naive - offsetMinutes(utc) * 60000; // second pass settles DST edges
  return new Date(utc).toISOString();
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" in Pacific time, for datetime-local inputs. */
export function isoToPacificLocal(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  return new Date(ms + offsetMinutes(ms) * 60000).toISOString().slice(0, 16);
}

export function pacificLabel(iso: string | Date | null | undefined, withTime = true): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", withTime ? { dateStyle: "medium", timeStyle: "short", timeZone: TZ } : { dateStyle: "medium", timeZone: TZ });
}
