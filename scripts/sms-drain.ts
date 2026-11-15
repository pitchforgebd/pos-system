// P10 task 6. Sends what waits in the SMS outbox, for every shop of the database DATABASE_URL points at. Meant for a cron job (every minute or two)
// on the server; the app also sends right after each request that queued a message, so this only catches what that missed (a restart, a retry).
//
//   node --experimental-strip-types --import ./src/test/register.mjs scripts/sms-drain.ts
//
// It uses the SMS provider of the environment (SMS_PROVIDER ...). Without one it sends nothing and says so.
import { prisma } from "../src/lib/db/client.ts";
import { drainOutbox } from "../src/modules/sms/outbox.ts";

const result = await drainOutbox({ limit: 500 });
if (!result.configured) {
  console.log("No SMS provider is set up (SMS_PROVIDER): the messages wait in the outbox.");
} else {
  console.log(`sent ${result.sent}, to try again ${result.retrying}, failed ${result.failed}`);
}
await prisma.$disconnect();
