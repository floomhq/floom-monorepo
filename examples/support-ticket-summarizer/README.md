# Support Ticket Summarizer

Paste a support ticket and get root cause, urgency, owner, and reply draft.

## Run

```bash
PORT=15406 node examples/support-ticket-summarizer/server.mjs
curl -X POST http://127.0.0.1:15406/support-ticket-summarizer/run -H 'content-type: application/json' -d '{"ticket":"Customer cannot export CSV after uploading a 20MB file. Error appears after 30 seconds."}'
```
