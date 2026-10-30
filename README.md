# Samjho

**Understand any official notice in your language, with every claim checked against the document.**

A landlord's notice, a tax letter or a bank demand can be frightening when you can't follow the language. A chatbot can explain it, but it can also confidently invent a section number or get a deadline wrong. Samjho is a harness that doesn't take the model's word for it.

## What it does

Paste a document or upload a photo, then choose English, Hindi, Hinglish, Bengali, Marathi, Tamil or Telugu. You get:

- a plain summary and urgency level
- deadlines with the days left
- amounts, key points and next steps
- when to get professional help, and a draft reply

## How the harness works

1. **Redact.** Aadhaar, PAN, phone, email and account numbers in the text are removed before any model call.
2. **Transcribe.** Photos become text that you check and correct, so everything after this step can be verified.
3. **Agent loop.** The model calls `date_add`, `sum_amounts` and `search_document`, then `submit_report`.
4. **Verify.** The server checks every quote against the document, checks each amount against its quote, and recalculates relative deadlines. Days left are calculated by code.
5. **Repair.** Failed claims go back to the model once. Anything still unsupported is shown with a warning.

The document is treated as data, so instructions hidden inside it are reported and not followed. Busy responses are retried with backoff, and cut-off tool calls are never executed.

## Run it

Requires Node 20 or later. There are no dependencies.

```bash
cp .env.example .env
```

Add your key from [bharatcode.ai](https://bharatcode.ai) to `.env`, then:

```bash
npm start
```

Open http://127.0.0.1:3000 and press **Try a sample**.

```bash
npm test
```

The tests use a scripted mock of the API, so they don't need a key.

## Privacy and limits

Text is redacted, but this is pattern matching and can miss things. Photos are sent as they are, so cover private details first. Documents go to BharatCode's API and its inference partners. Samjho stores nothing itself.

Samjho gives general information, not legal or financial advice. It doesn't decide whether a document is genuine. If you deploy it publicly, add rate limiting and authentication in front of it, because the app has neither.

## License

MIT
