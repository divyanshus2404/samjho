import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { analyzeDocument, createClient, transcribeImage } from './lib/agent.js';
import { redact } from './lib/report.js';

const root = new URL('./', import.meta.url);
const envFile = new URL('.env', root);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const API_KEY = process.env.BHARATCODE_API_KEY;
const MAX_BODY = 10 * 1024 * 1024;
const MAX_DOCUMENT = 40_000;
const LANGUAGES = new Set(['English', 'Hindi', 'Hinglish', 'Bengali', 'Marathi', 'Tamil', 'Telugu']);
const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const chat = createClient({
  apiKey: API_KEY,
  baseUrl: process.env.BHARATCODE_BASE_URL ?? 'https://bharatcode.ai/api/model/v1',
  model: process.env.BHARATCODE_MODEL ?? 'qwen-3.8-27b',
});

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
  if (typeof image !== 'string' || !IMAGE_PATTERN.test(image)) {
    return sendJson(response, 400, { error: 'Please upload a JPG, PNG or WebP image.' });
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
    send({ type: 'report', report });
  } catch (error) {
    send({ type: 'error', error: error.message });
  }
  response.end();
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(readFileSync(new URL('public/index.html', root)));
    }
    if (request.method === 'POST' && ['/api/transcribe', '/api/analyze'].includes(request.url)) {
      if (!API_KEY) return sendJson(response, 500, { error: 'BHARATCODE_API_KEY is not set on the server.' });
      return await (request.url === '/api/transcribe' ? handleTranscribe : handleAnalyze)(request, response);
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message });
    else response.end();
  }
});

server.listen(PORT, HOST, () => console.log(`Samjho is running at http://${HOST}:${PORT}`));
