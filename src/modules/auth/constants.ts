export const SESSION_COOKIE = "meridian_session";

/** Absolute session lifetime. Activity does not extend it. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const RESET_LIMIT = 5;
export const RESET_WINDOW_MS = 60 * 60 * 1000;
export const RESET_TOKEN_SECONDS = 30 * 60;
