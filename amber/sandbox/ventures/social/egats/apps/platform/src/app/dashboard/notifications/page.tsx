export const revalidate = 0;
export const metadata = { title: "EGATS | Notifications", robots: "noindex" };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NotificationsClient, { type Notification } from "./NotificationsClient";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: notifications = [] } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <NotificationsClient
      initialNotifications={(notifications ?? []) as Notification[]}
      userId={user.id}
    />
  );
}
