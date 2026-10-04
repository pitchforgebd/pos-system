const { createServer } = require("node:http");
const { parse } = require("node:url");
const next = require("next");

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((request, response) => {
    handle(request, response, parse(request.url, true)).catch(() => {
      response.statusCode = 500;
      response.end("internal server error");
    });
  }).listen(port, hostname);
}).catch(() => {
  process.exit(1);
});
