// Turns uploaded files into text and deadlines into calendar entries.

import { createHash } from 'node:crypto';
import { addToDate } from './tools.js';

export async function extractPdfText(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let pdf;
  try {
    pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  } catch {
    throw new Error('Could not read this PDF. If it has a password, remove it first.');
  }
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const { items } = await page.getTextContent();
    pages.push(items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join('').trim());
  }
  await pdf.destroy();
  const text = pages.join('\n\n').trim();
  if (text.length < 20) throw new Error('This PDF looks scanned and has no text. Please use a photo of each page instead.');
  return text;
}

function escapeIcs(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Only dated deadlines that passed verification go on someone's calendar.
export function toCalendar(report) {
  const deadlines = report.deadlines.filter((item) => item.date && item.verified);
  if (deadlines.length === 0) return null;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const compact = (date) => date.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Samjho//EN'];
  for (const item of deadlines) {
    const uid = createHash('sha256').update(`${item.date}|${item.label}|${item.quote}`).digest('hex').slice(0, 24);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@samjho`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(item.date)}`,
      `DTEND;VALUE=DATE:${compact(addToDate(item.date, 1, 'days'))}`,
      `SUMMARY:${escapeIcs(item.label)}`,
      `DESCRIPTION:${escapeIcs(`From the notice: "${item.quote}"`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(item.label)}`,
      'TRIGGER:-P3D',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
