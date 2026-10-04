import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-16 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
