#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeDocument, transcribeImage } from './lib/agent.js';
import { clientFromEnv, LANGUAGES, loadEnv, MAX_DOCUMENT } from './lib/config.js';
import { redact } from './lib/report.js';

const USAGE = `Usage: samjho <file> [options]
       cat notice.txt | samjho [options]

Explains an official notice in plain language and checks each claim against it.
<file> can be text, or a JPG, PNG or WebP photo.

Options:
  -l, --lang <language>  ${LANGUAGES.join(', ')} (default: English)
      --json             Print the report as JSON
      --quiet            Hide progress messages
  -h, --help             Show this help

Set BHARATCODE_API_KEY in your environment or in .env.`;

const IMAGE_TYPES = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' };

function fail(message, code = 1) {
  console.error(`samjho: ${message}`);
  process.exit(code);
}

function localToday() {
  const now = new Date();
  return new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function deadlineText(item) {
  if (!item.date) return 'date depends on when you received this';
  if (item.days_left < 0) return `${item.date} (passed ${-item.days_left} days ago)`;
  if (item.days_left === 0) return `${item.date} (today)`;
  return `${item.date} (${item.days_left} days left)`;
}

function formatReport(report) {
  const lines = [`${report.doc_type} from ${report.sender}`, `Urgency: ${report.urgency}`, '', report.summary];
  const section = (title, items, build) => {
    if (!items.length) return;
    lines.push('', title.toUpperCase());
    for (const item of items) lines.push(...build(item));
  };
  const quote = (item) => `    "${item.quote}" ${item.verified ? '[found in document]' : '[NOT VERIFIED, check this yourself]'}`;

  section('Deadlines', report.deadlines, (item) => [`  ${deadlineText(item)}: ${item.label}`, quote(item)]);
  section('Money', report.amounts, (item) => [`  Rs. ${Number(item.amount).toLocaleString('en-IN')}: ${item.label}`, quote(item)]);
  section('What it says', report.key_points, (item) => [`  ${item.text}`, quote(item)]);
  section('What to do', report.actions, (item) => [`  - ${item.step}`, `    ${item.why}`]);
  section('When to get help', report.get_help ? [report.get_help] : [], (text) => [`  ${text}`]);
  section('Draft reply', report.draft_reply ? [report.draft_reply] : [], (text) => [text]);
  lines.push('', 'General information, not legal or financial advice.');
  return lines.join('\n');
}

function describeStep(step) {
  if (step.type === 'tool' && step.name === 'date_add') return `Calculated a date: ${step.result.date}`;
  if (step.type === 'tool' && step.name === 'sum_amounts') return `Added up amounts: ${step.result.total}`;
  if (step.type === 'tool') return `Searched the document for "${step.args.query}"`;
  if (step.type === 'verify') return step.problems ? `${step.problems} claim(s) not supported by the document` : 'Every quote matched the document';
  if (step.type === 'retry') return 'Response was cut off, trying again';
  return null;
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      lang: { type: 'string', short: 'l', default: 'English' },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (error) {
  fail(`${error.message}\n\n${USAGE}`, 2);
}
const { values, positionals } = args;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length > 1) fail('Please give one file at a time.', 2);
if (positionals.length === 0 && process.stdin.isTTY) fail(`No document given.\n\n${USAGE}`, 2);

const language = LANGUAGES.find((name) => name.toLowerCase() === values.lang.toLowerCase());
if (!language) fail(`Unsupported language "${values.lang}". Choose from: ${LANGUAGES.join(', ')}`, 2);

loadEnv();
if (!process.env.BHARATCODE_API_KEY) fail('BHARATCODE_API_KEY is not set. Add it to your environment or to .env.');

const log = (message) => { if (!values.quiet) console.error(message); };
const chat = clientFromEnv();
const path = positionals[0];

try {
  let text;
  const imageType = path && IMAGE_TYPES[extname(path).toLowerCase()];
  if (imageType) {
    log('Reading the photo...');
    const image = `data:image/${imageType};base64,${readFileSync(path).toString('base64')}`;
    text = await transcribeImage(chat, image);
    console.error(`Text read from the photo. Compare it with the original, because quotes are checked against this text:\n\n${redact(text)}\n`);
  } else {
    text = readFileSync(path ?? 0, 'utf8');
  }
  if (text.trim().length < 20) fail('Please give the full text of the document.', 2);
  if (text.length > MAX_DOCUMENT) fail('This document is too long. Please use the most important pages.', 2);

  log('Reading the document...');
  const report = await analyzeDocument({
    chat,
    document: redact(text),
    language,
    today: localToday(),
    onStep: (step) => {
      const message = describeStep(step);
      if (message) log(message);
    },
  });
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
} catch (error) {
  fail(error.message);
}
