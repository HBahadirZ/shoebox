// Turns OCR (or pasted e-mail) text into a best guess of store, purchase date and total.
// Every field is a suggestion the person confirms, so the aim is "usually right, never wild".
import { toISO, parseISO } from './dates.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const plausible = (y, m, d, now) => {
  if (y < 2000 || !parseISO(toISO(y, m, d))) return false;
  return Date.UTC(y, m - 1, d) <= now.getTime() + 2 * 86400000; // a little slack for time zones
};
const fullYear = (y) => (y < 100 ? 2000 + y : y);

/** dayFirst: true for most of the world, false for US-style numeric dates. */
export function findDate(text, { dayFirst = false, now = new Date() } = {}) {
  const t = text.replace(/[|]/g, '/');
  const cands = [];
  const push = (index, y, m, d) => { y = fullYear(y); if (plausible(y, m, d, now)) cands.push({ index, iso: toISO(y, m, d) }); };
  let m;
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = iso.exec(t))) push(m.index, +m[1], +m[2], +m[3]);
  const mdy = new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4}|\\d{2})\\b`, 'gi');
  while ((m = mdy.exec(t))) push(m.index, +m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\.?,?\\s+(\\d{4}|\\d{2})\\b`, 'gi');
  while ((m = dmy.exec(t))) push(m.index, +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  const num = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g;
  while ((m = num.exec(t))) {
    const a = +m[1], b = +m[2], y = +m[3];
    let day, mon;
    if (a > 12 && b <= 12) { day = a; mon = b; } else if (b > 12 && a <= 12) { day = b; mon = a; } else if (dayFirst) { day = a; mon = b; } else { day = b; mon = a; }
    push(m.index, y, mon, day);
  }
  cands.sort((x, y) => x.index - y.index);
  return cands.length ? cands[0].iso : null;
}

const CODES = 'USD|CAD|EUR|GBP|AUD|NZD';
const MONEY = new RegExp(`(?:\\b(${CODES})\\s*)?([$€£])?\\s*(\\d{1,3}(?:[,.\\s]\\d{3})*[.,]\\d{2}|\\d+[.,]\\d{2})(?!\\d)(?:\\s*\\b(${CODES})\\b)?`, 'g');

export function toNumber(raw) {
  let s = raw.replace(/\s/g, '');
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  if (dec === -1) return Number(s);
  const intPart = s.slice(0, dec).replace(/[.,]/g, '');
  const n = Number(`${intPart}.${s.slice(dec + 1)}`);
  return Number.isFinite(n) ? n : NaN;
}

const fixDigits = (line) => line
  .replace(/(?<=\d[.,]?)[oO](?=[\d.,])/g, '0')
  .replace(/(?<=\d[.,]\d)[oO](?!\p{L})/gu, '0')
  .replace(/(?<=[$€£]\s?)[oO](?=\d)/g, '0');

function moneyIn(line) {
  const out = [];
  let m;
  MONEY.lastIndex = 0;
  const l = fixDigits(line);
  while ((m = MONEY.exec(l))) {
    const v = toNumber(m[3]);
    if (Number.isFinite(v)) out.push({ value: v, symbol: m[2] || '', code: (m[1] || m[4] || '').toUpperCase() });
  }
  return out;
}

const TOTAL_KEYS = [
  /grand\s*total/i, /total\s*(?:due|amount|paid|charged|sale)/i, /amount\s*(?:due|paid|charged)/i, /balance\s*due/i, /order\s*total/i, /\btotal\b/i,
];
const NOT_TOTAL = /sub\s*-?\s*total|tax|vat|gst|hst|pst|saving|discount|tip\b|items?\b|change|tender|cash|points|rewards/i;

export function findTotal(text) {
  const lines = text.split(/\r?\n/);
  for (const key of TOTAL_KEYS) {
    const hits = [];
    lines.forEach((line, i) => {
      if (!key.test(line) || NOT_TOTAL.test(line.replace(key, ''))) return;
      let nums = moneyIn(line);
      if (!nums.length && lines[i + 1]) nums = moneyIn(lines[i + 1]); // amount wrapped onto the next line
      if (nums.length) hits.push(nums[nums.length - 1]);
    });
    if (hits.length) return hits[hits.length - 1];
  }
  // No label found: the largest amount that is not cash handed over or change.
  let best = null;
  for (const line of lines) {
    if (/change|tender|cash|visa|master|amex|debit|credit/i.test(line)) continue;
    for (const n of moneyIn(line)) if (!best || n.value > best.value) best = n;
  }
  return best;
}

const SKIP_STORE = /receipt|invoice|order\b|tel\b|phone|fax|www\.|http|@|date|time|cashier|store\s*#|thank|welcome|tax id|vat|gst|^\W*\d/i;
export function findStore(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[^\p{L}\p{N}&'.,\-\s]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
  const good = lines.filter((l) => /\p{L}{3,}/u.test(l) && !SKIP_STORE.test(l) && l.length <= 40);
  if (!good.length) return '';
  const upper = good.find((l) => l === l.toUpperCase() && /\p{L}{3,}/u.test(l));
  const pick = upper || good[0];
  return /^[A-Z0-9&'.,\-\s]+$/.test(pick) ? pick.toLowerCase().replace(/(^|[\s&'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : pick;
}

export function currencyFromSymbol(symbol) {
  return { '€': 'EUR', '£': 'GBP' }[symbol] || null; // "$" is ambiguous, so the person's own currency is kept
}

export function parseReceipt(text, opts = {}) {
  const total = findTotal(text);
  return {
    store: findStore(text),
    date: findDate(text, opts),
    price: total ? total.value : null,
    currency: total ? (total.code || currencyFromSymbol(total.symbol)) : null,
  };
}
