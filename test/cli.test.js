import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-upstream.js';

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const DOCUMENT = `Date: 20 October 2026
Rent for August, September and October 2026 is unpaid. PAN ABCDE1234F.
Late fee of Rs. 2,500 is also due.
Pay within 15 days of the date of this notice.`;

function runCli(args, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, BHARATCODE_API_KEY: 'test', BHARATCODE_BASE_URL: baseUrl ?? 'http://127.0.0.1:1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(DOCUMENT);
  });
}

test('explains a piped document and redacts it first', async () => {
  const mock = await startMock();
  const { code, stdout, stderr } = await runCli(['--lang', 'hindi'], mock.url);
  mock.close();
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Rent default notice/);
  assert.match(stdout, /\[found in document\]/);
  assert.match(stderr, /Every quote matched/);
  const sent = JSON.stringify(mock.requests[0].messages);
  assert.ok(!sent.includes('ABCDE1234F'));
  assert.match(sent, /in Hindi/);
});

test('--json prints only JSON on stdout', async () => {
  const mock = await startMock();
  const { code, stdout } = await runCli(['--json', '--quiet'], mock.url);
  mock.close();
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).deadlines[0].date, '2026-11-04');
});

test('rejects an unsupported language', async () => {
  const { code, stderr } = await runCli(['--lang', 'klingon']);
  assert.equal(code, 2);
  assert.match(stderr, /Unsupported language/);
});
