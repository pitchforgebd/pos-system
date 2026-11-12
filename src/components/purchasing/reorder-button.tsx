"use client";

import { Button } from "@/components/ui/button";
import { useSubmit } from "@/lib/client/use-submit";

/** One click from the reorder list to purchase drafts, one per vendor (nothing is posted; the drafts are changed and ordered from the purchases list). */
export function ReorderDraftsButton() {
  const { submit, pending, message } = useSubmit();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        loading={pending}
        onClick={() =>
          void submit<{ ids: string[]; skipped: number }>(
            { url: "/api/v1/purchases/from-reorder", body: {} },
            {
              successMessage: "ক্রয় খসড়া তৈরি হয়েছে। (Purchase drafts made.)",
              goTo: "/purchases?status=DRAFT",
            },
          )
        }
      >
        Make purchase drafts
      </Button>
      <span className="text-sm text-muted">One draft for each vendor the products were last bought from, at the last price.</span>
      {message ? <span className="text-sm text-error" role="alert">{message}</span> : null}
    </div>
  );
}
