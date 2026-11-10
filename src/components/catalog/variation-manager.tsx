"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Head = { id: string; name: string; values: Array<{ id: string; value: string; variants: number }> };

/** Adds a variation (Size, Colour, Pack ...). */
export function AddHeadForm() {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="flex max-w-md flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        void submit({ url: "/api/v1/products/variations", body: { name: String(new FormData(element).get("name") ?? "").trim() } }, { onSuccess: () => element.reset() });
      }}
    >
      <Input name="name" required placeholder="New variation, e.g. Size" aria-label="Variation name" />
      <Button type="submit" loading={pending}>
        Add variation
      </Button>
      {message ? <p className="w-full text-sm text-error">{message}</p> : null}
    </form>
  );
}

/** One variation with its values: add a value, remove one that no variant uses, remove the variation itself. */
export function HeadCard({ head, canEdit }: { head: Head; canEdit: boolean }) {
  const { submit, pending, message } = useSubmit();
  return (
    <section className="space-y-2 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{head.name}</h3>
        {canEdit ? (
          <button type="button" className="text-sm underline" onClick={() => void submit({ url: `/api/v1/products/variations/${head.id}`, method: "DELETE" }, { successMessage: "Removed." })}>
            Remove variation
          </button>
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {head.values.length === 0 ? <li className="text-muted">No values yet.</li> : null}
        {head.values.map((value) => (
          <li key={value.id} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
            {value.value}
            {value.variants > 0 ? <span className="text-xs text-muted">({value.variants})</span> : null}
            {canEdit && value.variants === 0 ? (
              <button type="button" aria-label={`Remove ${value.value}`} className="text-xs underline" onClick={() => void submit({ url: `/api/v1/products/variations/${head.id}/values?valueId=${value.id}`, method: "DELETE" }, { successMessage: "Removed." })}>
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="flex max-w-sm flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const element = event.currentTarget;
            void submit({ url: `/api/v1/products/variations/${head.id}/values`, body: { value: String(new FormData(element).get("value") ?? "").trim() } }, { onSuccess: () => element.reset() });
          }}
        >
          <Input name="value" required placeholder="Add a value" aria-label={`New ${head.name} value`} />
          <Button type="submit" variant="secondary" loading={pending}>
            Add value
          </Button>
        </form>
      ) : null}
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </section>
  );
}
