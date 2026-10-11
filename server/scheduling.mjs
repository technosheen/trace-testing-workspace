const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_SEARCH = 5 * 366 * 24 * HOUR;
const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
function field(source, [min, max]) {
  const values = new Set();
  for (const part of source.split(',')) {
    if (!/^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?$/.test(part)) throw new Error('Use numeric cron fields with *, lists, ranges, or steps.');
    const [base, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) throw new Error('Invalid cron step.');
    const bounds = base === '*' ? [min,max] : base.includes('-') ? base.split('-').map(Number) : [Number(base), stepText ? max : Number(base)];
    const [start,end] = bounds;
    if (start < min || end > max || start > end) throw new Error(`Cron value must be between ${min} and ${max}.`);
    for (let n=start; n<=end; n+=step) values.add(n);
  }
  return {values, unrestricted: source === '*'};
}
function parse(expression) {
  if (typeof expression !== 'string' || expression.length > 200) throw new Error('Enter a five-field cron expression.');
  const tokens = expression.trim().split(/\s+/);
  if (tokens.length !== 5) throw new Error('Cron must have five fields: minute hour day month weekday.');
  const fields = tokens.map((token,i) => field(token,ranges[i]));
  if (fields[0].values.size !== 1) throw new Error('Schedules must run at most once per hour. Choose one minute value.');
  if (fields[4].values.delete(7)) fields[4].values.add(0);
  return {expression: tokens.join(' '), fields};
}
function formatter(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 100 || !timeZone.trim() || /^[+-]/.test(timeZone)) throw new Error('Enter a valid IANA time zone.');
  try {return new Intl.DateTimeFormat('en-US', { timeZone, year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', hourCycle:'h23', weekday:'short' });}
  catch {throw new Error('Enter a valid IANA time zone, such as America/New_York.');}
}
const weekdays = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
function parts(fmt, timestamp) {
  const values = Object.fromEntries(fmt.formatToParts(new Date(timestamp)).map(p=>[p.type,p.value]));
  return {year:Number(values.year),month:Number(values.month),day:Number(values.day),hour:Number(values.hour),minute:Number(values.minute),weekday:weekdays[values.weekday]};
}
function matches(fields,p) {
  const [minute,hour,day,month,weekday] = fields;
  const dom=day.values.has(p.day), dow=weekday.values.has(p.weekday);
  const dateMatch=day.unrestricted && weekday.unrestricted ? true : day.unrestricted ? dow : weekday.unrestricted ? dom : dom || dow;
  return minute.values.has(p.minute) && hour.values.has(p.hour) && month.values.has(p.month) && dateMatch;
}
/** Canonical persisted schedule fields. Interval schedules retain existing elapsed-time semantics. */
export function normalizeSchedule(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid schedule.');
  const scheduleType = input.scheduleType || input.type || (input.cronExpression || input.cron ? 'cron' : 'interval');
  if (scheduleType === 'interval') {
    const intervalHours = input.intervalHours ?? 24;
    if (typeof intervalHours !== 'number' || !Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 168) throw new Error('Interval must be between 1 and 168 hours.');
    return {scheduleType:'interval',intervalHours};
  }
  if (scheduleType !== 'cron') throw new Error('Schedule type must be interval or cron.');
  const {expression} = parse(input.cronExpression ?? input.cron);
  const timeZone = (input.timeZone ?? input.timezone ?? 'UTC').trim();
  formatter(timeZone);
  return {scheduleType:'cron',cronExpression:expression,timeZone};
}
/** Find the next real UTC minute after now. Missing local times are skipped, repeated DST hours may run twice, at least an hour apart. Search is bounded to five years. */
export function nextScheduleAt(schedule, nowDate = new Date()) {
  const normalized = normalizeSchedule(schedule);
  const now = new Date(nowDate).getTime();
  if (!Number.isFinite(now)) throw new Error('Invalid schedule reference time.');
  if (normalized.scheduleType === 'interval') return new Date(now + normalized.intervalHours * HOUR).toISOString();
  const {fields} = parse(normalized.cronExpression);
  const fmt = formatter(normalized.timeZone);
  const minute = [...fields[0].values][0];
  let cursor = Math.floor(now / MINUTE) * MINUTE + MINUTE;
  const end = now + MAX_SEARCH;
  while (cursor <= end) {
    const local = parts(fmt,cursor);
    if (local.minute !== minute) {cursor += ((minute - local.minute + 60) % 60) * MINUTE;continue;}
    if (matches(fields,local)) {
      // A 30-minute DST rollback can repeat a matching wall time less than an hour later.
      // Keep the first occurrence only, preserving the hourly budget in those zones.
      let tooClose = false;
      for (let delta=MINUTE; delta<HOUR; delta+=MINUTE) if (matches(fields,parts(fmt,cursor-delta))) {tooClose=true;break;}
      if (!tooClose) return new Date(cursor).toISOString();
    }
    cursor += HOUR;
  }
  throw new Error('Cron has no occurrence within the next five years. Check its day and month fields.');
}
