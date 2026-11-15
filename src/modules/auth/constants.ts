export const SESSION_COOKIE = "meridian_session";

/** Absolute session lifetime. Activity does not extend it. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Sign-in: the same address and email, any email from one address, and (when the proxy gives no address) everyone sharing "unknown" (S2, S5).
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * MINUTE;
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_UNKNOWN_IP_LIMIT = 300;
/** Failed sign-ins written to the audit log for one address in an hour; the rest are counted by the limit but not written (S3). */
export const FAILED_LOGIN_AUDIT_PER_HOUR = 10;
/** Failures after which each next failure waits a little longer before the answer (S10); the step is LOGIN_DELAY_STEP_MS (default 500). */
export const LOGIN_DELAY_AFTER = 2;
export const LOGIN_DELAY_MAX_MS = 3000;

// Password reset: asking (one email, any email from one address) and finishing with a token (S6).
export const RESET_LIMIT = 5;
export const RESET_WINDOW_MS = HOUR;
export const RESET_IP_LIMIT = 20;
export const RESET_DONE_IP_LIMIT = 10;
export const RESET_TOKEN_SECONDS = 30 * 60;

/** The default idle timeout in minutes (N20); each shop sets its own. */
export const IDLE_TIMEOUT_DEFAULT_MINUTES = 30;
/** `lastSeenAt` is written at most this often, so reading a page does not write to the database every time. */
export const LAST_SEEN_WRITE_MS = MINUTE;
