// Deterministic helpers. The model calls these instead of doing arithmetic itself.

const DAY_MS = 86_400_000;

function parseDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCMonth() === +match[2] - 1 ? date : null;
}

export function isValidDate(iso) {
  return parseDate(iso) !== null;
}

export function addToDate(start, amount, unit) {
  const date = parseDate(start);
  if (!date) throw new Error(`Invalid date "${start}", expected YYYY-MM-DD`);
  if (!Number.isInteger(amount)) throw new Error('amount must be a whole number');

  if (unit === 'days') {
    date.setUTCDate(date.getUTCDate() + amount);
  } else if (unit === 'months' || unit === 'years') {
    const months = unit === 'months' ? amount : amount * 12;
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    // Clamp so that 31 Jan + 1 month is the end of February, not early March.
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  } else {
    throw new Error('unit must be days, months or years');
  }
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return null;
  return Math.round((end - start) / DAY_MS);
}

export function sumAmounts(amounts) {
  if (!Array.isArray(amounts) || !amounts.every(Number.isFinite)) {
    throw new Error('amounts must be a list of numbers');
  }
  return Math.round(amounts.reduce((total, n) => total + n, 0) * 100) / 100;
}

export function searchDocument(document, query) {
  const needle = normalize(query);
  if (!needle) return [];
  return document
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => normalize(text).includes(needle))
    .slice(0, 10);
}

// Makes quote matching tolerant of case, spacing and typographic differences only.
export function normalize(text) {
  return String(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export const TOOL_DEFINITIONS = [
  {
    name: 'date_add',
    description: 'Add days, months or years to a date. Use this for every relative deadline, such as "within 15 days of this notice".',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'YYYY-MM-DD' },
        amount: { type: 'integer' },
        unit: { type: 'string', enum: ['days', 'months', 'years'] },
      },
      required: ['start', 'amount', 'unit'],
    },
  },
  {
    name: 'sum_amounts',
    description: 'Add up rupee amounts. Use this for every total you report.',
    parameters: {
      type: 'object',
      properties: { amounts: { type: 'array', items: { type: 'number' } } },
      required: ['amounts'],
    },
  },
  {
    name: 'search_document',
    description: 'Find the lines of the document that contain a phrase. Use this to copy exact quotes.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'submit_report',
    description: 'Submit the finished explanation. Every quote must be copied exactly from the document.',
    parameters: {
      type: 'object',
      properties: {
        doc_type: { type: 'string' },
        sender: { type: 'string' },
        summary: { type: 'string', description: 'Two or three plain sentences: what this is and what it wants from the reader.' },
        urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
        key_points: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, quote: { type: 'string' } },
            required: ['text', 'quote'],
          },
        },
        deadlines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              quote: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD, or empty if the document does not let you work it out' },
              calc: {
                type: 'object',
                description: 'Required when the deadline is relative to another date.',
                properties: {
                  start: { type: 'string' },
                  amount: { type: 'integer' },
                  unit: { type: 'string', enum: ['days', 'months', 'years'] },
                },
                required: ['start', 'amount', 'unit'],
              },
            },
            required: ['label', 'quote', 'date'],
          },
        },
        amounts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              quote: { type: 'string' },
              amount: { type: 'number' },
            },
            required: ['label', 'quote', 'amount'],
          },
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { step: { type: 'string' }, why: { type: 'string' } },
            required: ['step', 'why'],
          },
        },
        get_help: { type: 'string', description: 'When and from whom to get professional help.' },
        draft_reply: { type: 'string', description: 'A short reply the reader could send, with [placeholders]. Empty if no reply is needed.' },
      },
      required: ['doc_type', 'sender', 'summary', 'urgency', 'key_points', 'deadlines', 'amounts', 'actions', 'get_help', 'draft_reply'],
    },
  },
].map((fn) => ({ type: 'function', function: fn }));
