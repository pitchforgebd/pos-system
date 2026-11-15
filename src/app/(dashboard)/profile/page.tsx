import { redirect } from "next/navigation";

import { ChangePasswordForm, ProfileDetailsForm } from "@/components/auth/profile-forms";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("My profile");

export default async function ProfilePage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const user = await prisma.user.findFirst({
    where: { id: session.userId, organizationId: session.organizationId },
    select: { name: true, email: true, phone: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!user) {
    redirect("/login");
  }
  const roles = user.roles.map((row) => row.role.name).join(", ");
  return (
    <div className="space-y-8">
      <PageHeader
        title={ph("My profile")}
        description={ph("Your name and phone, and your password.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("My profile") }]}
      />
      <section className="space-y-3" aria-label={ph("Details")}>
        <h2 className="text-lg font-semibold">{ph("Details")}</h2>
        <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">{ph("Email")}</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted">{ph("Roles")}</dt>
          <dd>{roles || ph("None")}</dd>
          <dt className="text-muted">{ph("Branches")}</dt>
          <dd>{session.branches.map((branch) => branch.name).join(", ") || ph("None")}</dd>
        </dl>
        <ProfileDetailsForm name={user.name} phone={user.phone ?? ""} />
      </section>
      <section className="space-y-3" aria-label={ph("Password")}>
        <h2 className="text-lg font-semibold">{ph("Change password")}</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
