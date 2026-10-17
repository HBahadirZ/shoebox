import { coverage, addDays, parseISO } from './dates.js';

const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCSV(items, today) {
  const head = ['Item', 'Store', 'Purchase date', 'Price', 'Currency', 'Category', 'Warranty months', 'Warranty ends', 'Return days', 'Return by', 'Notes'];
  const rows = items.map((it) => {
    const c = coverage(it, today);
    return [it.name, it.store, it.date, it.price ?? '', it.currency, it.category || '',
      it.warrantyMonths === -1 ? 'lifetime' : it.warrantyMonths || '', c.warrantyEnd || '', it.returnDays || '', c.returnEnd || '', it.notes || ''];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

const icsDate = (iso) => iso.replace(/-/g, '');
const esc = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
/** One all-day event per warranty end and per return deadline, each with a 7-day heads-up. */
export function toICS(items, today, stamp = new Date()) {
  const ts = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BeeZ Mobile Solutions//Shoebox//EN', 'CALSCALE:GREGORIAN'];
  const ev = (id, date, title, desc) => {
    if (!parseISO(date)) return;
    out.push('BEGIN:VEVENT', `UID:${id}@shoebox.local`, `DTSTAMP:${ts}`, `DTSTART;VALUE=DATE:${icsDate(date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(date, 1))}`,
      `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:-P7D', 'END:VALARM', 'END:VEVENT');
  };
  for (const it of items) {
    const c = coverage(it, today);
    if (c.warrantyEnd && c.warranty !== 'expired') ev(it.id + '-w', c.warrantyEnd, `Warranty ends: ${it.name}`, `${it.name} from ${it.store || 'store'} is covered until this date.`);
    if (c.returnEnd && c.return !== 'closed') ev(it.id + '-r', c.returnEnd, `Last day to return: ${it.name}`, `Return window for ${it.name} from ${it.store || 'store'} closes today.`);
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

export function download(name, type, data) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
