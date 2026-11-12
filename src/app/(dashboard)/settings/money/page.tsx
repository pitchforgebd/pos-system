import { redirect } from "next/navigation";

import { ChargeRuleForm, ShiftRuleForm } from "@/components/treasury/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { shiftRequired } from "@/modules/shifts/shifts";
import { listChargeRules } from "@/modules/treasury/charges";

export const metadata = { title: "Money & Charges" };

export default async function MoneySettingsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [rules, requireShift] = await Promise.all([listChargeRules(session.organizationId), shiftRequired(session.organizationId)]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Money & Charges"
        description="What a bank or a mobile banking account takes on a payment, and whether cash needs a shift."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings", href: "/settings" }, { label: "Money & Charges" }]}
      />
      <section className="space-y-3" aria-label="Shifts">
        <h2 className="text-lg font-semibold">Shifts</h2>
        <ShiftRuleForm requireShift={requireShift} />
      </section>
      <section className="space-y-3" aria-label="Charges">
        <h2 className="text-lg font-semibold">Charges on payments</h2>
        <p className="text-sm text-muted">
          Each bank and mobile account takes a percentage and a fixed part of what goes through it. The receipt, payment, transfer and expense forms propose the charge from this and you may change it. The shop bears the charge by
          default (it is an expense: Bank charges or Mobile banking charges). If the customer bears it, the form tells you how much more they should send.
        </p>
        {rules.length === 0 ? <p className="text-sm text-muted">Add a bank or a mobile banking account in Bank &amp; Cash first.</p> : null}
        <div className="space-y-2">
          {rules.map((rule) => (
            <ChargeRuleForm key={rule.accountId} rule={rule} />
          ))}
        </div>
      </section>
    </div>
  );
}
