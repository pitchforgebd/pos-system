import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

// The integration tests create and delete rows through DATABASE_URL (read from .env).
// A production configuration has NODE_ENV=production and an https APP_URL, so refuse to run there.
function setting(name) {
  if (process.env[name] !== undefined) {
    return process.env[name];
  }
  try {
    const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
    return match ? match[1].trim().replace(/^"|"$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

if (setting("NODE_ENV") === "production" || (setting("APP_URL") ?? "").startsWith("https://")) {
  throw new Error(
    "Refusing to run tests: this looks like a production configuration (NODE_ENV=production or an https APP_URL). " +
      "Run tests against a development or CI database.",
  );
}
