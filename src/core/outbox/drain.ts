// Work that must happen after a request's transaction has committed, never inside it (P10 task 10): sending the SMS the request queued. A module
// that queues something calls requestDrain(); defineRoute calls scheduleDrain() when a write succeeded, which runs the registered drain once the
// response has gone (Next's after). Outside a request (a script, a test) nothing is scheduled: the caller drains itself.

type Runner = () => Promise<unknown>;
type After = (task: () => Promise<void>) => void;
const KEY = Symbol.for("meridian.outbox.drain");
type Holder = { [KEY]?: { runner: Runner | null; wanted: boolean } };

function state() {
  const holder = globalThis as Holder;
  holder[KEY] ??= { runner: null, wanted: false };
  return holder[KEY];
}

/** The SMS module registers how the outbox is drained. */
export function registerDrain(runner: Runner) {
  state().runner = runner;
}

/** Something was queued: drain after this request. */
export function requestDrain() {
  state().wanted = true;
}

/**
 * Called by defineRoute after a write succeeded. Next's `after` is loaded here, not at the top: outside Next (the test runner, a script) it cannot
 * be loaded or used, and then nothing is scheduled.
 */
export async function scheduleDrain() {
  const current = state();
  if (!current.wanted || !current.runner) {
    return;
  }
  current.wanted = false;
  const runner = current.runner;
  try {
    const { after } = (await import("next/server")) as { after: After };
    after(async () => {
      try {
        await runner();
      } catch {
        // a failed send stays in the outbox and is tried again; nothing else to do here
      }
    });
  } catch {
    // not inside a request: whoever queued it drains it
  }
}
