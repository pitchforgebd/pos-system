const { createServer } = require("node:http");
const { parse } = require("node:url");
const next = require("next");

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

let server = null;
let stopping = false;

function stop(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  console.error(`[server] ${signal} received, shutting down.`);
  const finish = () => {
    // The application stores its Prisma client on globalThis (src/lib/db/client.ts).
    Promise.resolve(globalThis.prisma ? globalThis.prisma.$disconnect() : undefined)
      .catch((error) => console.error("[server] database disconnect failed:", error))
      .finally(() => process.exit(0));
  };
  if (server) {
    server.close(finish);
    // Do not wait forever for idle keep-alive connections.
    setTimeout(finish, 10000).unref();
  } else {
    finish();
  }
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection:", reason);
});

app
  .prepare()
  .then(() => {
    server = createServer((request, response) => {
      handle(request, response, parse(request.url, true)).catch((error) => {
        console.error("[server] request failed:", error);
        response.statusCode = 500;
        response.end("internal server error");
      });
    });
    server.listen(port, hostname, () => {
      console.error(`[server] listening on ${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error("[server] failed to start:", error);
    process.exit(1);
  });
