import AdminPanel from "@/components/admin/AdminPanel";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/admin",
  title: "Admin · Mimir Markets",
  description: "Read-only status of markets, users and services.",
  index: false,
});

export default function AdminPage() {
  return <AdminPanel />;
}
