# Samjho

**Understand any official notice in your language, with every claim checked against the document.**

A landlord's notice, a tax letter or a bank demand can be frightening when you can't follow the language. A chatbot can explain it, but it can also confidently invent a section number or get a deadline wrong. Samjho is a harness that doesn't take the model's word for it.

## Quick start

You need Node 20.19 or later and one key from [bharatcode.ai](https://bharatcode.ai).

```bash
git clone https://github.com/divyanshus2404/samjho && cd samjho
npm install
cp .env.example .env
```

Add your key to `.env`, then use the terminal or the web app:

```bash
npm link
samjho notice.pdf --lang hindi
```

```bash
npm start
```

## What you get

Give it a PDF, a photo or text, in English, Hindi, Hinglish, Bengali, Marathi, Tamil or Telugu. You get:

- a plain summary and urgency level
- deadlines with the days left
- amounts, key points and next steps
- when to get professional help, and a draft reply
- follow-up answers backed by quotes
- a calendar file of verified deadlines, with a reminder 3 days before each

```bash
samjho notice.pdf --ask "Can they make me leave right away?"
samjho notice.pdf --calendar deadlines.ics
cat notice.txt | samjho --json --quiet
```

The report goes to stdout and progress goes to stderr, so the output can be piped into other tools. Exit codes are 0 for success, 1 for a runtime failure and 2 for bad usage.

## How the harness works

1. **Redact.** Aadhaar, PAN, phone, email and account numbers in the text are removed before any model call.
2. **Read.** PDFs become text on your machine. Photos are transcribed by the model, and the text is shown to you for checking.
3. **Agent loop.** The model calls `date_add`, `sum_amounts` and `search_document`, then `submit_report`.
4. **Verify.** Code checks every quote against the document, checks each amount against its quote, and recalculates relative deadlines. Days left are calculated by code.
5. **Repair.** Failed claims go back to the model once. Anything still unsupported is shown with a warning.

The document is treated as data, so instructions hidden inside it should be reported and not followed. Busy responses are retried with backoff, and cut-off tool calls are never executed.

## Testing

```bash
npm test
```

These tests use a scripted mock of the API, so they don't need a key.

```bash
npm run eval
```

This runs made-up notices with known answers through the real model and prints a score. The set covers a Hindi notice, a deadline that can't be calculated and an instruction hidden in the document. See [evals/cases.js](evals/cases.js).

## Privacy and limits

- Text is redacted by pattern matching, which can miss things.
- Photos are sent as they are, so cover private details first. Scanned PDFs must be uploaded as photos.
- A misread photo can pass verification, because quotes are checked against the transcribed text.
- Documents go to BharatCode's API and its inference partners. Samjho stores nothing itself.
- Samjho gives general information, not legal or financial advice, and doesn't decide whether a document is genuine.

If you host the web app, it limits each address to 30 requests an hour (`RATE_LIMIT_PER_HOUR`). Set `HOST=0.0.0.0` to accept outside traffic, and `TRUST_PROXY=1` only behind a proxy that appends the client address. It has no login.

## License

MIT
