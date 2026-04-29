# AEO Analytics

Brand + competitors -> AI answer visibility score and recommendations.

## Run

```bash
PORT=15403 node examples/openanalytics-aeo/server.mjs
curl -X POST http://127.0.0.1:15403/openanalytics-aeo/run -H 'content-type: application/json' -d '{"brand":"Floom","competitors":["n8n","Make"]}'
```
