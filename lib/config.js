import { existsSync, readFileSync } from 'node:fs';
import { createClient } from './agent.js';

export const LANGUAGES = ['English', 'Hindi', 'Hinglish', 'Bengali', 'Marathi', 'Tamil', 'Telugu'];
export const MAX_DOCUMENT = 40_000;

export function loadEnv() {
  const envFile = new URL('../.env', import.meta.url);
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}

export function clientFromEnv() {
  return createClient({
    apiKey: process.env.BHARATCODE_API_KEY,
    baseUrl: process.env.BHARATCODE_BASE_URL ?? 'https://bharatcode.ai/api/model/v1',
    model: process.env.BHARATCODE_MODEL ?? 'qwen-3.8-27b',
  });
}
