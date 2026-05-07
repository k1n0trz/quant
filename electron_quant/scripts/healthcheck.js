const http = require('node:http');

const host = process.env.QUANT_WEB_HOST || '127.0.0.1';
const port = Number(process.env.QUANT_WEB_PORT || 47829);

const req = http.get({
  host,
  port,
  path: '/healthz',
  timeout: 5000
}, (res) => {
  let raw = '';
  res.on('data', (chunk) => { raw += chunk.toString(); });
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`Healthcheck failed with status ${res.statusCode}: ${raw}`);
      process.exit(1);
    }
    try {
      const data = JSON.parse(raw || '{}');
      if (data.ok !== true) {
        console.error(`Healthcheck returned unexpected payload: ${raw}`);
        process.exit(1);
      }
      console.log(`healthcheck OK ${host}:${port}`);
    } catch (error) {
      console.error(`Healthcheck response was not valid JSON: ${error.message}`);
      process.exit(1);
    }
  });
});

req.on('timeout', () => {
  req.destroy(new Error('timeout'));
});

req.on('error', (error) => {
  console.error(`Healthcheck connection failed: ${error.message}`);
  process.exit(1);
});
