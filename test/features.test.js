import test from 'node:test';
import assert from 'node:assert/strict';
import { askDocument, createClient } from '../lib/agent.js';
import { extractPdfText, toCalendar } from '../lib/documents.js';
import { CASES, scoreCase } from '../evals/cases.js';
import { startMock, toolCall } from './mock-upstream.js';

const DOCUMENT = 'Pay Rs. 2,500 within 15 days of the date of this notice.';

function minimalPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function ask(script) {
  const mock = await startMock(script);
  const chat = createClient({ apiKey: 'test', baseUrl: mock.url, model: 'm', sleep: async () => {} });
  try {
    return await askDocument({ chat, document: DOCUMENT, question: 'How much?', today: '2026-10-30' });
  } finally {
    mock.close();
  }
}

test('reads text from a PDF', async () => {
  const text = await extractPdfText(minimalPdf('Pay the total dues within 15 days of this notice'));
  assert.match(text, /within 15 days/);
});

test('rejects a file that is not a PDF', async () => {
  await assert.rejects(extractPdfText(Buffer.from('not a pdf')), /Could not read this PDF/);
});

test('a question gets an answer with verified quotes', async () => {
  const answer = await ask([toolCall('submit_answer', { answer: 'Rs. 2,500', in_document: true, quotes: ['Pay Rs. 2,500'] })]);
  assert.equal(answer.quotes[0].verified, true);
  assert.equal(answer.unverified.length, 0);
});

test('an answer with an invented quote is repaired, then flagged', async () => {
  const bad = toolCall('submit_answer', { answer: 'Jail', in_document: true, quotes: ['you will go to jail'] });
  const answer = await ask([bad, bad]);
  assert.equal(answer.quotes[0].verified, false);
  assert.equal(answer.unverified.length, 1);
});

test('an answer claiming document support must quote it', async () => {
  const answer = await ask([
    toolCall('submit_answer', { answer: 'Yes', in_document: true, quotes: [] }),
    toolCall('submit_answer', { answer: 'The document does not say.', in_document: false, quotes: [] }),
  ]);
  assert.equal(answer.in_document, false);
  assert.equal(answer.unverified.length, 0);
});

test('the calendar holds only dated, verified deadlines', () => {
  const calendar = toCalendar({
    deadlines: [
      { date: '2026-11-04', verified: true, label: 'Pay, now', quote: 'within 15 days' },
      { date: '2026-11-09', verified: false, label: 'Invented', quote: 'x' },
      { date: null, verified: true, label: 'Undated', quote: 'y' },
    ],
  });
  assert.match(calendar, /DTSTART;VALUE=DATE:20261104\r\n/);
  assert.match(calendar, /DTEND;VALUE=DATE:20261105\r\n/);
  assert.match(calendar, /SUMMARY:Pay\\, now\r\n/);
  assert.ok(!calendar.includes('Invented') && !calendar.includes('Undated'));
  assert.equal(toCalendar({ deadlines: [] }), null);
});

test('the eval scorer catches wrong answers', () => {
  const report = {
    summary: 'Nothing is due.', actions: [], unverified: ['x'],
    deadlines: [{ date: '2026-11-26' }], amounts: [{ amount: 3000 }],
  };
  const failed = scoreCase(CASES.at(-1), report).filter((check) => !check.passed).map((check) => check.name);
  assert.deepEqual(failed, ['deadline 2026-11-25', 'all claims verified', 'not misled by "nothing is due"']);
});
