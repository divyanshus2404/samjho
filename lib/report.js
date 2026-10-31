// Checks the model's report against the document. Nothing here trusts the model.

import { addToDate, daysBetween, isValidDate, normalize } from './tools.js';

const REDACTIONS = [
  [/(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}(?!\d)/g, '[AADHAAR]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]'],
  [/(?<!\d|\d,)(?:\+?91[ -]?)?[6-9]\d{9}(?!\d|,\d)/g, '[PHONE]'],
  [/(?<!\d|\d,)\d{9,18}(?!\d|,\d)/g, '[ACCOUNT]'],
];

export function redact(text) {
  return REDACTIONS.reduce((result, [pattern, label]) => result.replace(pattern, label), text);
}

function quoteFound(quote, document) {
  const needle = normalize(quote);
  return needle.length > 0 && normalize(document).includes(needle);
}

function digits(value) {
  return String(value).replace(/\D/g, '');
}

function amountInQuote(amount, quote) {
  // Whole rupees are compared without paise, so 5000 matches "Rs. 5,000.00".
  const whole = digits(Math.trunc(Math.abs(amount)));
  return whole.length > 0 && new RegExp(`(^|\\D)${whole}(\\D|$)`).test(quote.replace(/,/g, ''));
}

export function checkAnswer(raw, document) {
  const quotes = (Array.isArray(raw.quotes) ? raw.quotes : []).map((quote) => ({
    quote,
    verified: quoteFound(quote, document),
  }));
  const problems = quotes.filter((item) => !item.verified).map((item) => `quote not found in document: "${item.quote}"`);
  // An answer drawn from the document has to show where in the document it came from.
  if (!raw.in_document) return { answer: { ...raw, quotes: [] }, problems: [] };
  if (quotes.length === 0) problems.push('the answer has no quote from the document');
  return { answer: { ...raw, quotes }, problems };
}

export function checkReport(raw, document, today) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const problems = [];

  const check = (item, kind) => {
    const verified = quoteFound(item.quote, document);
    if (!verified) problems.push(`${kind} quote not found in document: "${item.quote}"`);
    return { ...item, verified };
  };

  const deadlines = list(raw.deadlines).map((item) => {
    const checked = check(item, 'deadline');
    let date = isValidDate(item.date) ? item.date : null;
    let recalculated = false;
    if (item.calc) {
      try {
        const computed = addToDate(item.calc.start, item.calc.amount, item.calc.unit);
        recalculated = computed !== date;
        date = computed;
      } catch {
        problems.push(`deadline "${item.label}" has an invalid calc`);
      }
    }
    return { ...checked, date, recalculated, days_left: date ? daysBetween(today, date) : null };
  });

  const amounts = list(raw.amounts).map((item) => {
    const checked = check(item, 'amount');
    if (!checked.verified) return checked;
    const verified = amountInQuote(item.amount, String(item.quote));
    if (!verified) problems.push(`amount ${item.amount} does not appear in its quote: "${item.quote}"`);
    return { ...checked, verified };
  });

  const report = {
    ...raw,
    key_points: list(raw.key_points).map((item) => check(item, 'key point')),
    deadlines,
    amounts,
    actions: list(raw.actions),
  };
  report.deadlines.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  return { report, problems };
}
