import { area } from "@/lib/i18n/messages/define";

// What a screen says for the standard answers of the server (the envelope codes), when the server's own sentence is English only.

export const errors = area(
  {
    "errors.AUTHENTICATION_ERROR": "Please sign in again.",
    "errors.AUTHORIZATION_ERROR": "You do not have permission for this action.",
    "errors.RATE_LIMITED": "Too many attempts. Try again later.",
    "errors.NOT_FOUND": "That record was not found.",
    "errors.CONFLICT": "That conflicts with what is already saved.",
    "errors.VALIDATION_ERROR": "Some of what you entered is not valid.",
    "errors.INTERNAL_ERROR": "Something went wrong. Try again.",
  },
  {
    "errors.AUTHENTICATION_ERROR": "আবার সাইন ইন করুন।",
    "errors.AUTHORIZATION_ERROR": "এই কাজের অনুমতি আপনার নেই।",
    "errors.RATE_LIMITED": "অনেকবার চেষ্টা হয়েছে। একটু পরে আবার চেষ্টা করুন।",
    "errors.NOT_FOUND": "রেকর্ডটি পাওয়া যায়নি।",
    "errors.CONFLICT": "যা আগে থেকে সংরক্ষিত আছে, এটি তার সাথে মেলে না।",
    "errors.VALIDATION_ERROR": "আপনার দেওয়া কিছু তথ্য সঠিক নয়।",
    "errors.INTERNAL_ERROR": "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।",
  },
);
