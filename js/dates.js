// Plain calendar-date maths on "YYYY-MM-DD" strings. No time zones involved.
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
const utc = (iso) => { const p = parseISO(iso); return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN; };

export const todayISO = (now = new Date()) => toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
export function addDays(iso, n) {
  const t = new Date(utc(iso) + n * 86400000);
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
/** Adds calendar months; a 31 Jan purchase + 1 month ends 28/29 Feb, not 3 Mar. */
export function addMonths(iso, n) {
  const p = parseISO(iso);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toISO(y, m, Math.min(p.d, dim));
}

export const SOON_DAYS = 60;        // warranty "ending soon"
export const RETURN_SOON_DAYS = 7;  // return window "closing"

/** warrantyMonths: 0 none, -1 lifetime. returnDays: 0 none. The end date itself still counts as covered. */
export function coverage(rec, today) {
  const out = { warrantyEnd: null, warrantyDays: null, warranty: 'none', returnEnd: null, returnDays: null, return: 'none' };
  if (!parseISO(rec.date)) return out;
  if (rec.warrantyMonths === -1) out.warranty = 'lifetime';
  else if (rec.warrantyMonths > 0) {
    out.warrantyEnd = addMonths(rec.date, rec.warrantyMonths);
    out.warrantyDays = daysBetween(today, out.warrantyEnd);
    out.warranty = out.warrantyDays < 0 ? 'expired' : out.warrantyDays <= SOON_DAYS ? 'soon' : 'active';
  }
  if (rec.returnDays > 0) {
    out.returnEnd = addDays(rec.date, rec.returnDays);
    out.returnDays = daysBetween(today, out.returnEnd);
    out.return = out.returnDays < 0 ? 'closed' : out.returnDays <= RETURN_SOON_DAYS ? 'closing' : 'open';
  }
  return out;
}
export const needsAttention = (c) => c.warranty === 'soon' || c.return === 'closing';
/** Smaller = more urgent. Used to sort the "needs attention" list. */
export function urgency(c) {
  const a = [];
  if (c.warranty === 'soon') a.push(c.warrantyDays);
  if (c.return === 'closing') a.push(c.returnDays);
  return a.length ? Math.min(...a) : Infinity;
}

export function formatDate(iso, locale) {
  const p = parseISO(iso);
  if (!p) return '';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
}
/** "today", "in 12 days", "in 5 months", "3 days ago" */
export function humanizeDays(n) {
  if (n === 0) return 'today';
  const abs = Math.abs(n);
  let v, unit;
  if (abs <= 60) { v = abs; unit = abs === 1 ? 'day' : 'days'; }
  else if (abs < 730) { v = Math.round(abs / 30.4); unit = 'months'; }
  else { v = Math.round((abs / 365.25) * 10) / 10; unit = 'years'; }
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${v} ${unit}` : `${v} ${unit} ago`;
}
