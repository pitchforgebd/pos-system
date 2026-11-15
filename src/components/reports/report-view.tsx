import type { ReportResult } from "@/modules/reports/kit";
import { getPhrase } from "@/lib/i18n/server";

// One report on screen and on paper (P11): the summary, each table with its total, and the identity lines, green or red with the difference.

export async function ReportView({ result, lang }: { result: ReportResult; lang: "en" | "bn" }) {
  const ph = await getPhrase();
  return (
    <article className="print-sheet space-y-5">
      {result.summary.length > 0 ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          {result.summary.map((item) => (
            <div key={item.label.en} className="rounded-xl border border-border bg-surface px-3 py-2">
              <dt className="text-muted">{item.label[lang]}</dt>
              <dd className="text-lg font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {result.sections.map((section) => (
        <section key={section.key} className="space-y-2" aria-label={section.title[lang]}>
          <h2 className="text-base font-semibold">{section.title[lang]}</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left">
                <tr>
                  {section.columns.map((column) => (
                    <th key={column.key} className={`px-2 py-1.5 font-medium ${column.numeric ? "text-right" : ""}`}>
                      {column.label[lang]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-muted" colSpan={section.columns.length}>
                      {lang === "bn" ? "কিছু নেই" : ph("Nothing in this period")}
                    </td>
                  </tr>
                ) : (
                  section.rows.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {section.columns.map((column) => (
                        <td key={column.key} className={`px-2 py-1 ${column.numeric ? "text-right tabular-nums" : ""}`}>
                          {row[column.key] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
                {section.total ? (
                  <tr className="border-t-2 border-border font-semibold">
                    {section.columns.map((column, index) => (
                      <td key={column.key} className={`px-2 py-1 ${column.numeric ? "text-right tabular-nums" : ""}`}>
                        {index === 0 ? (lang === "bn" ? "মোট" : ph("Total")) : (section.total?.[column.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {result.identities.length > 0 ? (
        <section className="space-y-1" aria-label={lang === "bn" ? "মিলের লাইন" : ph("Checks")}>
          <h2 className="text-base font-semibold">{lang === "bn" ? "মিলের লাইন" : ph("Checks against the books")}</h2>
          <ul className="space-y-1 text-sm">
            {result.identities.map((check) => (
              <li key={check.label.en} className={`rounded-md px-2 py-1 ${check.ok ? "bg-success-subtle text-success" : "bg-error-subtle text-error"}`}>
                {check.ok ? "✔" : "✘"} {check.label[lang]} — {check.left} / {check.right}
                {check.ok ? "" : ` (${lang === "bn" ? "পার্থক্য" : "difference"} ${check.difference})`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
