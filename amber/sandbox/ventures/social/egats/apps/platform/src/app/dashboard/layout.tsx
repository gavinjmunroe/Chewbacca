import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import MobileNavToggle from "@/components/mobile-nav-toggle";
import { ToastProvider } from "@/components/toast-provider";
import { ErrorBoundary } from "@/components/error-boundary";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, avatar_url")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  // Redirect to onboarding if profile display_name is missing, unless already on that page
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";
  if (!pathname.startsWith("/dashboard/onboarding") && (!profile.display_name || profile.display_name.trim() === "")) {
    redirect("/dashboard/onboarding");
  }

  // Check if user has accepted current terms version
  const CURRENT_TERMS_VERSION = "1.0";
  if (!pathname.startsWith("/dashboard/accept-terms")) {
    const { data: termsAccepted } = await supabase
      .from("terms_acceptances")
      .select("id")
      .eq("user_id", user.id)
      .eq("version", CURRENT_TERMS_VERSION)
      .maybeSingle();
    if (!termsAccepted) {
      redirect("/dashboard/accept-terms");
    }
  }

  // Fetch unread notification count for nav badge
  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);

  return (
    <ToastProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-violet-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen bg-[#09090B]">
        {/* Desktop nav — hidden on mobile */}
        <div className="hidden lg:block">
          <Nav
            role={profile.role}
            displayName={profile.display_name}
            avatarUrl={profile.avatar_url}
            unreadNotifications={unreadCount ?? 0}
            userId={user.id}
          />
        </div>
        {/* Mobile nav toggle — visible only on mobile */}
        <MobileNavToggle
          role={profile.role}
          displayName={profile.display_name}
          avatarUrl={profile.avatar_url}
          unreadNotifications={unreadCount ?? 0}
        />
        <ErrorBoundary>
          <main id="main-content" className="flex-1 lg:ml-[228px] min-h-screen">
            <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 pt-16 lg:pt-10">{children}</div>
          </main>
        </ErrorBoundary>
      </div>
    </ToastProvider>
  );
}
