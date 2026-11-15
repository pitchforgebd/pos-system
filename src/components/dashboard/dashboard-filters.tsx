"use client";

import { useRouter } from "next/navigation";

import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

/** The branch and the day of the dashboard. Changing either opens the page again with that choice. */
export function DashboardFilters({ day, scope, branches, branchId }: { day: string; scope: "branch" | "all"; branches: { id: string; name: string }[]; branchId: string | null }) {
  const router = useRouter();
  const { submit } = useSubmit();
  const { t } = useI18n();

  function openDay(nextDay: string, nextScope: "branch" | "all") {
    const params = new URLSearchParams({ date: nextDay });
    if (nextScope === "all") {
      params.set("scope", "all");
    }
    router.push(`/dashboard?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">
        <span className="sr-only">{t("dashboard.branchLabel")}</span>
        <select
          className="h-10 min-w-40 rounded-md border border-border bg-surface px-3"
          value={scope === "all" ? "all" : (branchId ?? "")}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "all") {
              openDay(day, "all");
              return;
            }
            // The header and layout read the session branch, so the page is opened again with fresh server data.
            void submit({ url: "/api/v1/session/branch", body: { branchId: value } }, { quiet: true, goTo: `/dashboard?date=${day}` });
          }}
        >
          <option value="all">{t("dashboard.allBranches")}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="sr-only">{t("dashboard.dateLabel")}</span>
        <input
          type="date"
          value={day}
          className="h-10 rounded-md border border-border bg-surface px-3"
          onChange={(event) => {
            if (event.target.value) {
              openDay(event.target.value, scope);
            }
          }}
        />
      </label>
    </div>
  );
}
