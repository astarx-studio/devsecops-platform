const http = require('http');
const PORT = process.env.PORT || 3000;

const handler = (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'smoke-api',
        env: process.env.DEPLOY_ENV || 'unknown',
      }),
    );
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        message: 'Hello from Smoke API!',
        env: process.env.DEPLOY_ENV || 'unknown',
      }),
    );
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
};

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`Smoke API listening on port ${PORT}`);
});
