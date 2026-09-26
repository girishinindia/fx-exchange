import { notFound } from "next/navigation";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { findNavItem } from "@/lib/nav";

/** Placeholder for portal screens that are not built yet — shows which phase delivers them. */
export default async function ComingSoon({ params }: PageProps<"/[...slug]">) {
  const { slug } = await params;
  const path = "/" + slug.join("/");
  const item = findNavItem(path) ?? (path === "/profile" ? { label: "My Profile", phase: 1, icon: "fa-user" } : undefined);
  if (!item) notFound();

  return (
    <>
      <PageHeader title={item.label} />
      <div className="bg-white rounded-xl border border-sky-100 shadow-card">
        <EmptyState
          icon={item.icon}
          title={`Built in Phase ${item.phase}`}
          text="This screen is designed (see FX Portal Design) and will be implemented in its phase."
          action={
            <LinkButton href="/dashboard" variant="secondary">
              Back to dashboard
            </LinkButton>
          }
        />
      </div>
    </>
  );
}
