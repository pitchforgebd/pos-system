import { PermissionDenied } from "@/components/ui/states";
import { getPhrase } from "@/lib/i18n/server";

export default async function ForbiddenPage() {
  const ph = await getPhrase();
  return (
    <PermissionDenied
      description={ph("Your account cannot open this screen.")}
      title={ph("Permission required")}
    />
  );
}
