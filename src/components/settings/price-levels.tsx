"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Level = { id: string; name: string; isDefault: boolean; status: "ACTIVE" | "INACTIVE"; prices: number; customerTypes: number };

export function AddLevelForm() {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="flex max-w-md flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        void submit({ url: "/api/v1/price-levels", body: { name: String(new FormData(element).get("name") ?? "").trim() } }, { onSuccess: () => element.reset() });
      }}
    >
      <Input name="name" required placeholder="New price level, e.g. Export" aria-label="Price level name" />
      <Button type="submit" loading={pending}>
        Add level
      </Button>
      {message ? <p className="w-full text-sm text-error">{message}</p> : null}
    </form>
  );
}

/** One level: rename it, switch it on or off, make it the default. */
export function LevelRow({ level }: { level: Level }) {
  const { submit, pending, message } = useSubmit();
  const patch = (body: Record<string, unknown>) => void submit({ url: `/api/v1/price-levels/${level.id}`, method: "PATCH", body });
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2 text-sm">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          patch({ name: String(new FormData(event.currentTarget).get("name") ?? "").trim() });
        }}
      >
        <Input name="name" defaultValue={level.name} aria-label={`Name of ${level.name}`} />
        <Button type="submit" variant="secondary" loading={pending}>
          Rename
        </Button>
      </form>
      {level.isDefault ? (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">Default</span>
      ) : (
        <>
          <button type="button" className="underline" onClick={() => patch({ makeDefault: true })}>
            Make default
          </button>
          <button type="button" className="underline" onClick={() => patch({ status: level.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>
            {level.status === "ACTIVE" ? "Switch off" : "Switch on"}
          </button>
        </>
      )}
      <span className="text-muted">
        {level.prices} price(s) · {level.customerTypes} customer type(s) {level.status === "INACTIVE" ? "· off" : ""}
      </span>
      {message ? <span className="w-full text-error">{message}</span> : null}
    </li>
  );
}

/** Which level a customer type buys at. */
export function TypeLevelSelect({ type, levels }: { type: { id: string; name: string; priceLevelId: string | null }; levels: Level[] }) {
  const { submit, message } = useSubmit();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-48">{type.name}</span>
      <select
        aria-label={`Price level of ${type.name}`}
        defaultValue={type.priceLevelId ?? ""}
        className="h-10 rounded-md border border-border bg-surface px-2"
        onChange={(event) => {
          const chosen = event.target.value;
          const target = chosen || levels.find((level) => level.isDefault)?.id || levels[0]?.id;
          if (target) {
            void submit({ url: `/api/v1/price-levels/${target}`, method: "PATCH", body: { customerTypeId: type.id, assign: Boolean(chosen) } });
          }
        }}
      >
        <option value="">Default level</option>
        {levels
          .filter((level) => level.status === "ACTIVE")
          .map((level) => (
            <option key={level.id} value={level.id}>
              {level.name}
            </option>
          ))}
      </select>
      {message ? <span className="text-error">{message}</span> : null}
    </label>
  );
}
