import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, createClient } from '../lib/agent.js';
import { checkReport, redact } from '../lib/report.js';
import { addToDate, sumAmounts } from '../lib/tools.js';
import { SAMPLE_REPORT, startMock, toolCall } from './mock-upstream.js';

const DOCUMENT = `Date: 20 October 2026
You have not paid rent for August, September and October 2026.
Late fee of Rs. 2,500 is also due.
Pay within 15 days of the date of this notice.`;
const TODAY = '2026-10-30';

async function run(script) {
  const mock = await startMock(script);
  const chat = createClient({ apiKey: 'test', baseUrl: mock.url, model: 'm', sleep: async () => {} });
  try {
    const steps = [];
    const report = await analyzeDocument({ chat, document: DOCUMENT, today: TODAY, onStep: (s) => steps.push(s) });
    return { report, steps, requests: mock.requests };
  } finally {
    mock.close();
  }
}

test('runs tools, then returns a verified report', async () => {
  const { report, requests } = await run([
    toolCall('date_add', { start: '2026-10-20', amount: 15, unit: 'days' }),
    toolCall('submit_report', SAMPLE_REPORT),
  ]);
  assert.equal(report.unverified.length, 0);
  assert.equal(report.deadlines[0].date, '2026-11-04');
  assert.equal(report.deadlines[0].days_left, 5);
  const toolMessage = requests[1].messages.at(-1);
  assert.equal(toolMessage.role, 'tool');
  assert.deepEqual(JSON.parse(toolMessage.content), { date: '2026-11-04' });
});

test('sends invented quotes back for repair once', async () => {
  const bad = { ...SAMPLE_REPORT, key_points: [{ text: 'Invented', quote: 'you will be arrested' }] };
  const { report, requests } = await run([toolCall('submit_report', bad), toolCall('submit_report', SAMPLE_REPORT)]);
  assert.equal(report.repairs, 1);
  assert.equal(report.unverified.length, 0);
  assert.match(requests[1].messages.at(-1).content, /you will be arrested/);
});

test('flags a claim the model will not fix instead of hiding it', async () => {
  const bad = { ...SAMPLE_REPORT, key_points: [{ text: 'Invented', quote: 'you will be arrested' }] };
  const { report } = await run([toolCall('submit_report', bad), toolCall('submit_report', bad)]);
  assert.equal(report.key_points[0].verified, false);
  assert.equal(report.unverified.length, 1);
});

test('does not execute a cut-off response', async () => {
  const cutOff = toolCall('date_add', { start: 'bad', amount: 1, unit: 'days' });
  cutOff.choices[0].finish_reason = 'length';
  const { steps, requests } = await run([cutOff, toolCall('submit_report', SAMPLE_REPORT)]);
  assert.ok(!steps.some((s) => s.type === 'tool_error'));
  assert.equal(requests[1].max_tokens, 12000);
});

test('retries when the model is busy', async () => {
  const { report } = await run([503, 503, toolCall('submit_report', SAMPLE_REPORT)]);
  assert.equal(report.unverified.length, 0);
});

test('reports a bad tool call to the model and continues', async () => {
  const { requests, report } = await run([
    toolCall('date_add', { start: 'soon', amount: 1, unit: 'days' }),
    toolCall('submit_report', SAMPLE_REPORT),
  ]);
  assert.match(requests[1].messages.at(-1).content, /Invalid date/);
  assert.ok(report);
});

test('server recalculates a wrong deadline date', () => {
  const raw = { ...SAMPLE_REPORT, deadlines: [{ ...SAMPLE_REPORT.deadlines[0], date: '2026-12-25' }] };
  const { report } = checkReport(raw, DOCUMENT, TODAY);
  assert.equal(report.deadlines[0].date, '2026-11-04');
  assert.equal(report.deadlines[0].recalculated, true);
});

test('an amount must appear in its quote', () => {
  const raw = { ...SAMPLE_REPORT, amounts: [{ label: 'Late fee', quote: 'Late fee of Rs. 2,500', amount: 25000 }] };
  const { report, problems } = checkReport(raw, DOCUMENT, TODAY);
  assert.equal(report.amounts[0].verified, false);
  assert.equal(problems.length, 1);
});

test('redacts identifiers but keeps rupee amounts and dates', () => {
  const text = 'Aadhaar 1234 5678 9012, PAN ABCDE1234F, call 9876543210, a@b.in, A/c 123456789012. Pay Rs. 1,25,000 by 20 October 2026.';
  const result = redact(text);
  for (const label of ['[AADHAAR]', '[PAN]', '[PHONE]', '[EMAIL]', '[ACCOUNT]']) assert.ok(result.includes(label), label);
  assert.ok(result.includes('Rs. 1,25,000 by 20 October 2026'));
});

test('date and sum helpers', () => {
  assert.equal(addToDate('2026-01-31', 1, 'months'), '2026-02-28');
  assert.equal(addToDate('2026-12-20', 15, 'days'), '2027-01-04');
  assert.equal(sumAmounts([18000, 18000, 18000, 2500]), 56500);
});
