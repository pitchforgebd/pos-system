import { PermissionDenied } from "@/components/ui/states";

export default function ForbiddenPage() {
  return (
    <PermissionDenied
      description="Your account cannot open this screen."
      title="Permission required"
    />
  );
}
