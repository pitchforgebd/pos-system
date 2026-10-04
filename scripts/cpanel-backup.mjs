import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

function readDatabaseUrl() {
  let parsed;
  try {
    parsed = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error("DATABASE_URL is missing or is not a URL.");
  }
  if (parsed.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must use the mysql protocol.");
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database || database.includes("/") || parsed.username === "") {
    throw new Error("DATABASE_URL must name a user and one database.");
  }
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port || "3306",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

function backupDirectory() {
  const chosen = process.env.BACKUP_DIR?.trim();
  const directory = resolve(chosen || join(process.cwd(), "..", "meridian-backups"));
  const folded = directory.split(sep).join("/");
  if (folded.endsWith("/public_html") || folded.includes("/public_html/")) {
    throw new Error("BACKUP_DIR must sit outside the web root.");
  }
  return directory;
}

function quote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "")}"`;
}

const database = readDatabaseUrl();
const directory = backupDirectory();
const stamp = new Date().toISOString().slice(0, 10);
const target = join(directory, `${database.database}-${stamp}.sql.gz`);
const defaults = join(tmpdir(), `meridian-backup-${process.pid}.cnf`);

await mkdir(directory, { recursive: true });
await writeFile(
  defaults,
  `[client]\nuser=${quote(database.user)}\npassword=${quote(database.password)}\nhost=${quote(database.host)}\nport=${database.port}\n`,
  { mode: 0o600 },
);

const dump = spawn("mysqldump", [`--defaults-extra-file=${defaults}`, "--single-transaction", "--routines", "--databases", database.database], {
  stdio: ["ignore", "pipe", "pipe"],
});
dump.stderr.on("data", () => {});
const finished = new Promise((resolveExit, reject) => {
  dump.on("error", () => reject(new Error("mysqldump is not available.")));
  dump.on("close", (code) => resolveExit(code));
});

let dumpCode = 1;
try {
  await pipeline(dump.stdout, createGzip(), createWriteStream(target, { mode: 0o600 }));
  dumpCode = await finished;
} finally {
  await rm(defaults, { force: true });
}

if (dumpCode !== 0) {
  await rm(target, { force: true });
  throw new Error("The database backup failed.");
}

const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
for (const name of await readdir(directory)) {
  const day = name.match(/(\d{4}-\d{2}-\d{2})\.sql\.gz$/);
  if (day && Date.parse(`${day[1]}T00:00:00.000Z`) < cutoff) {
    await rm(join(directory, name), { force: true });
  }
}

console.log(`backup written ${stamp}`);
