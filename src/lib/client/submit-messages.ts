// What a cashier reads when a save does not go through. Bangla first (the shop floor), English after it for support.
// A retry is safe in the first two cases because the same Idempotency-Key is sent again: the server saves once.
export const submitMessages = {
  network:
    "ইন্টারনেট সংযোগ নেই বা সার্ভারে পৌঁছানো যায়নি। সংযোগ ফিরলে আবার চাপুন — একই কাজ দুইবার সংরক্ষণ হবে না। (No connection. Press again when you are back online; it will not be saved twice.)",
  server:
    "সার্ভারে সমস্যা হয়েছে। একটু পরে আবার চাপুন — একই কাজ দুইবার সংরক্ষণ হবে না। (Something went wrong on the server. Try again; it will not be saved twice.)",
  rejected: "সংরক্ষণ হয়নি। (It was not saved.)",
  saved: "সংরক্ষিত হয়েছে। (Saved.)",
  busy: "আগের অনুরোধটি এখনো চলছে। (The previous request is still running.)",
} as const;
