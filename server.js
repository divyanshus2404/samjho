import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { analyzeDocument, askDocument, transcribeImage } from './lib/agent.js';
import { extractPdfText, toCalendar } from './lib/documents.js';
import { clientFromEnv, LANGUAGES as LANGUAGE_LIST, loadEnv, MAX_DOCUMENT } from './lib/config.js';
import { redact } from './lib/report.js';

const root = new URL('./', import.meta.url);
loadEnv();

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const API_KEY = process.env.BHARATCODE_API_KEY;
const MAX_BODY = 10 * 1024 * 1024;
const LANGUAGES = new Set(LANGUAGE_LIST);
const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const PDF_PREFIX = 'data:application/pdf;base64,';
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR ?? 30);
const RATE_WINDOW = 60 * 60 * 1000;
const usage = new Map();

const chat = clientFromEnv();

// Set TRUST_PROXY=1 only behind a proxy that appends the real client address.
function clientAddress(request) {
  const forwarded = process.env.TRUST_PROXY === '1' && request.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',').at(-1).trim() : request.socket.remoteAddress;
}

function allowRequest(address, now = Date.now()) {
  for (const [key, entry] of usage) {
    if (now - entry.start > RATE_WINDOW) usage.delete(key);
  }
  const entry = usage.get(address) ?? { start: now, count: 0 };
  entry.count++;
  usage.set(address, entry);
  return entry.count <= RATE_LIMIT;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('That file is too large. Please use one under 7 MB.'));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid request.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function handleTranscribe(request, response) {
  const { image } = await readJson(request);
  if (typeof image === 'string' && image.startsWith(PDF_PREFIX)) {
    try {
      const bytes = Buffer.from(image.slice(PDF_PREFIX.length), 'base64');
      return sendJson(response, 200, { text: redact(await extractPdfText(bytes)) });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }
  if (typeof image !== 'string' || !IMAGE_PATTERN.test(image)) {
    return sendJson(response, 400, { error: 'Please upload a PDF, or a JPG, PNG or WebP image.' });
  }
  sendJson(response, 200, { text: redact(await transcribeImage(chat, image)) });
}

async function handleAnalyze(request, response) {
  const { text, language, today } = await readJson(request);
  if (typeof text !== 'string' || text.trim().length < 20) {
    return sendJson(response, 400, { error: 'Please add the full text of the document.' });
  }
  if (text.length > MAX_DOCUMENT) {
    return sendJson(response, 400, { error: 'This document is too long. Please paste the most important pages.' });
  }
  if (!LANGUAGES.has(language)) return sendJson(response, 400, { error: 'Unsupported language.' });

  const validToday = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
  const document = redact(text);

  // Progress goes out line by line because requests can queue for shared capacity.
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  const send = (event) => response.write(`${JSON.stringify(event)}\n`);
  try {
    send({ type: 'redacted', document });
    const report = await analyzeDocument({ chat, document, language, today: validToday, onStep: send });
    send({ type: 'report', report, calendar: toCalendar(report) });
  } catch (error) {
    send({ type: 'error', error: error.message });
  }
  response.end();
}

async function handleAsk(request, response) {
  const { text, question, language, today } = await readJson(request);
  if (typeof text !== 'string' || text.trim().length < 20 || text.length > MAX_DOCUMENT) {
    return sendJson(response, 400, { error: 'Please add the full text of the document.' });
  }
  if (typeof question !== 'string' || !question.trim() || question.length > 500) {
    return sendJson(response, 400, { error: 'Please write a question of up to 500 characters.' });
  }
  if (!LANGUAGES.has(language)) return sendJson(response, 400, { error: 'Unsupported language.' });
  const validToday = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
  sendJson(response, 200, await askDocument({ chat, document: redact(text), question: redact(question), language, today: validToday }));
}

const HANDLERS = { '/api/transcribe': handleTranscribe, '/api/analyze': handleAnalyze, '/api/ask': handleAsk };

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(readFileSync(new URL('public/index.html', root)));
    }
    if (request.method === 'POST' && Object.hasOwn(HANDLERS, request.url)) {
      if (!API_KEY) return sendJson(response, 500, { error: 'BHARATCODE_API_KEY is not set on the server.' });
      if (!allowRequest(clientAddress(request))) {
        return sendJson(response, 429, { error: 'Too many requests. Please try again in an hour.' });
      }
      return await HANDLERS[request.url](request, response);
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message });
    else response.end();
  }
});

server.listen(PORT, HOST, () => console.log(`Samjho is running at http://${HOST}:${PORT}`));
