"use client";

import type { FormEvent } from "react";

import { useSubmit, type SubmitOptions } from "@/lib/client/use-submit";

/**
 * A plain form: on submit, read the fields, send them with `useSubmit`, show the answer. For the many forms that are
 * "a few inputs, one POST, refresh the page".
 *
 *   const form = useFormSubmit("/api/v1/shifts", (data) => ({ openingCash: data.get("openingCash") }));
 *   <form onSubmit={form.onSubmit}> … {form.message ? <p>{form.message}</p> : null} <Button loading={form.pending} />
 */
export function useFormSubmit<T = unknown>(url: string, body: (form: FormData) => unknown, options: SubmitOptions<T> = {}) {
  const { submit, pending, message, fields } = useSubmit();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit<T>({ url, body: body(new FormData(event.currentTarget)) }, options);
  }
  return { message, pending, fields, onSubmit };
}
