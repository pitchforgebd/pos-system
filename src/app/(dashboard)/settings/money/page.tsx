import { redirect } from "next/navigation";

import { ChargeRuleForm, ShiftRuleForm } from "@/components/treasury/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { shiftRequired } from "@/modules/shifts/shifts";
import { listChargeRules } from "@/modules/treasury/charges";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Money & Charges");

export default async function MoneySettingsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [rules, requireShift] = await Promise.all([listChargeRules(session.organizationId), shiftRequired(session.organizationId)]);

  return (
    <div className="space-y-8">
      <PageHeader
        title={ph("Money & Charges")}
        description={ph("What a bank or a mobile banking account takes on a payment, and whether cash needs a shift.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings", href: "/settings" }, { label: ph("Money & Charges") }]}
      />
      <section className="space-y-3" aria-label={ph("Shifts")}>
        <h2 className="text-lg font-semibold">{ph("Shifts")}</h2>
        <ShiftRuleForm requireShift={requireShift} />
      </section>
      <section className="space-y-3" aria-label={ph("Charges")}>
        <h2 className="text-lg font-semibold">{ph("Charges on payments")}</h2>
        <p className="text-sm text-muted">
          {ph("Each bank and mobile account takes a percentage and a fixed part of what goes through it. The receipt, payment, transfer and expense forms propose the charge from this and you may change it. The shop bears the charge by default (it is an expense: Bank charges or Mobile banking charges). If the customer bears it, the form tells you how much more they should send.")}
        </p>
        {rules.length === 0 ? <p className="text-sm text-muted">{ph("Add a bank or a mobile banking account in Bank & Cash first.")}</p> : null}
        <div className="space-y-2">
          {rules.map((rule) => (
            <ChargeRuleForm key={rule.accountId} rule={rule} />
          ))}
        </div>
      </section>
    </div>
  );
}
