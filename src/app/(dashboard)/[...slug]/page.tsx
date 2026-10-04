import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModuleScreen } from "@/components/screens/module-screen";
import { breadcrumbsFor, concreteScreenPaths, resolveScreen, screens, sectionNav } from "@/lib/screens/registry";

type View = "ready" | "loading" | "empty" | "error";

function readView(value: string | undefined): View {
  if (value === "loading" || value === "empty" || value === "error") {
    return value;
  }
  return "ready";
}

export function generateStaticParams() {
  return concreteScreenPaths().map((path) => ({
    slug: path.split("/").filter(Boolean),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const match = resolveScreen(slug);
  return { title: match?.record ? String(match.record.id) : (match?.spec.title ?? "Not found") };
}

export default async function ScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const match = resolveScreen(slug);
  if (!match) {
    notFound();
  }
  if (match.spec.kind === "detail" && !match.record) {
    notFound();
  }

  const path = `/${slug.join("/")}`;
  const detailBase = screens.some((screen) => screen.path === `${match.spec.path}/:id`) ? match.spec.path : undefined;

  return (
    <ModuleScreen
      spec={match.spec}
      record={match.record}
      nav={sectionNav(path)}
      crumbs={breadcrumbsFor(path)}
      view={readView(query.view)}
      detailBase={detailBase}
    />
  );
}
