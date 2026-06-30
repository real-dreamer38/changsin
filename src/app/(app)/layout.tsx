import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireUser();

  return (
    <div className="min-h-screen">
      <Nav profile={profile} />
      <main className="container py-6">{children}</main>
    </div>
  );
}
