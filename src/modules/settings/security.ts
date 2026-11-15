import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

// The shop's security settings. For now: how long a signed-in user may do nothing before being signed out (N20). The 12-hour absolute limit of a session
// is not a setting.

export const IDLE_MIN_MINUTES = 5;
export const IDLE_MAX_MINUTES = 720;

export async function getSecuritySettings(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { idleTimeoutMinutes: true } });
  return { idleTimeoutMinutes: org.idleTimeoutMinutes };
}

export async function setIdleTimeout(who: { organizationId: string; userId: string; ip: string; userAgent: string | null }, minutes: number) {
  const before = await getSecuritySettings(who.organizationId);
  await prisma.organization.update({ where: { id: who.organizationId }, data: { idleTimeoutMinutes: minutes } });
  await writeAudit({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "idle-timeout",
    module: "settings",
    entityType: "organization",
    entityId: who.organizationId,
    before,
    after: { idleTimeoutMinutes: minutes },
    ip: who.ip,
    userAgent: who.userAgent,
  });
  return { idleTimeoutMinutes: minutes };
}
