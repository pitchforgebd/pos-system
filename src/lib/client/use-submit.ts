"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { showToast } from "@/components/ui/toast";

import { submitMessages } from "@/lib/client/submit-messages";
import { createSubmitter, type SubmitFailure, type SubmitRequest, type SubmitResult } from "@/lib/client/submit-core";

export type SubmitOptions<T> = {
  /** Shown as a toast when the server accepted the request. */
  successMessage?: string;
  /** Go to this page after a success (a client-side navigation, not a page reload). Without it the current page is refreshed in place. */
  goTo?: string | ((data: T) => string);
  /** Refresh the page data after a success (default true; ignored when `goTo` is set). Turn off when the form shows the result itself. */
  refresh?: boolean;
  /** No toast and no refresh: for a read that has to be a POST (a preview). */
  quiet?: boolean;
  /** Runs after a success, before the page is refreshed or changed. */
  onSuccess?: (data: T, result: Extract<SubmitResult<T>, { ok: true }>) => void | Promise<void>;
};

/**
 * Every write from a form goes through this hook (N1, N23, U7, U8, L13): one Idempotency-Key per attempt, a retry after
 * a lost answer reuses it, a double click does nothing, a network failure is explained in Bangla, a success shows a
 * toast and refreshes the page data in place.
 *
 *   const { submit, pending, error } = useSubmit();
 *   submit({ url: "/api/v1/purchases", body }, { successMessage: "ক্রয় সংরক্ষিত", goTo: (p) => `/purchases/${p.id}` });
 */
export function useSubmit() {
  const router = useRouter();
  const [submitter] = useState(() => createSubmitter());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SubmitFailure | null>(null);

  const submit = useCallback(
    async <T = unknown>(request: SubmitRequest, options: SubmitOptions<T> = {}): Promise<SubmitResult<T>> => {
      if (submitter.busy) {
        return submitter.submit<T>(request); // answers "busy" without sending anything
      }
      setPending(true);
      setError(null);
      const result = await submitter.submit<T>(request);
      setPending(false);
      if (!result.ok) {
        setError(result);
        return result;
      }
      if (!options.quiet) {
        showToast(options.successMessage ?? submitMessages.saved, "success");
      }
      await options.onSuccess?.(result.data, result);
      if (options.goTo) {
        router.push(typeof options.goTo === "function" ? options.goTo(result.data) : options.goTo);
      } else if (options.refresh ?? !options.quiet) {
        router.refresh();
      }
      return result;
    },
    [router, submitter],
  );

  return {
    submit,
    pending,
    /** The last failure, or null. */
    error,
    /** Its message, or "" — what most forms print under the button. */
    message: error?.message ?? "",
    /** Field name -> message of a 400 that named fields. */
    fields: error?.fields ?? {},
    clearError: useCallback(() => setError(null), []),
    /** Start a new attempt on the next submit (the form was cleared). */
    reset: useCallback(() => submitter.reset(), [submitter]),
  };
}
