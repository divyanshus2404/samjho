// A scripted stand-in for BharatCode's API, for tests and for trying the UI without a key.
// Run directly: node test/mock-upstream.js, then start the app with
// BHARATCODE_BASE_URL=http://127.0.0.1:4010 BHARATCODE_API_KEY=mock npm start

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const toolCall = (name, args, id = `call_${name}`) => ({
  choices: [{
    finish_reason: 'tool_calls',
    message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
  }],
});

export const SAMPLE_REPORT = {
  doc_type: 'Rent default notice',
  sender: 'Sharma Properties',
  summary: 'Your landlord says three months of rent and a late fee are unpaid. Pay within 15 days, or the agreement ends and you must leave.',
  urgency: 'high',
  key_points: [{ text: 'Rent is unpaid for three months.', quote: 'August, September and October 2026' }],
  deadlines: [{ label: 'Pay all dues', quote: 'within 15 days of the date of this notice', date: '2026-11-04', calc: { start: '2026-10-20', amount: 15, unit: 'days' } }],
  amounts: [{ label: 'Late fee', quote: 'Late fee of Rs. 2,500', amount: 2500 }],
  actions: [{ step: 'Check your payment records', why: 'They show whether these dues are correct.' }],
  get_help: 'Talk to a lawyer or your District Legal Services Authority if you dispute the dues.',
  draft_reply: 'Dear Sir/Madam, I received your notice dated 20 October 2026. [Your response]',
};

export function defaultScript() {
  return [
    toolCall('date_add', { start: '2026-10-20', amount: 15, unit: 'days' }),
    toolCall('submit_report', SAMPLE_REPORT),
  ];
}

export function startMock(script = defaultScript(), port = 0) {
  const requests = [];
  let index = 0;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      const next = script[index++ % script.length];
      if (typeof next === 'number') {
        response.writeHead(next);
        return response.end();
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(next));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startMock(defaultScript(), 4010);
  console.log(`Mock model API at ${url}`);
}
