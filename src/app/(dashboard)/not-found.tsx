import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function DashboardNotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="That screen is not part of this application."
      action={
        <Button href="/dashboard" variant="secondary">
          Back to dashboard
        </Button>
      }
    />
  );
}
