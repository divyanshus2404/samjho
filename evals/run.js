// Runs every test notice through the real model and prints a score. Needs an API key.

import { analyzeDocument } from '../lib/agent.js';
import { clientFromEnv, loadEnv } from '../lib/config.js';
import { redact } from '../lib/report.js';
import { CASES, scoreCase, TODAY } from './cases.js';

loadEnv();
if (!process.env.BHARATCODE_API_KEY) {
  console.error('BHARATCODE_API_KEY is not set. Add it to your environment or to .env.');
  process.exit(1);
}

const chat = clientFromEnv();
let passed = 0;
let total = 0;

for (const testCase of CASES) {
  console.log(`\n${testCase.name}`);
  let checks;
  try {
    const report = await analyzeDocument({
      chat,
      document: redact(testCase.document),
      language: testCase.language ?? 'English',
      today: TODAY,
    });
    checks = scoreCase(testCase, report);
  } catch (error) {
    checks = [{ name: `run failed: ${error.message}`, passed: false }];
  }
  for (const check of checks) {
    total++;
    if (check.passed) passed++;
    console.log(`  ${check.passed ? 'PASS' : 'FAIL'}  ${check.name}`);
  }
}

console.log(`\nScore: ${passed}/${total} checks on ${process.env.BHARATCODE_MODEL ?? 'qwen-3.8-27b'}`);
process.exit(passed === total ? 0 : 1);
