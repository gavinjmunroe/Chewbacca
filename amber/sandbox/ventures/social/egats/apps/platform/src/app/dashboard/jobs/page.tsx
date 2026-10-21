export const revalidate = 0;
export const metadata = { title: 'EGATS | Jobs', robots: 'noindex' };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import JobCard from "@/components/job-card";
import JobsFilterBar from "./JobsFilterBar";
import type { Job } from "@/types/database";


export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ style?: string; type?: string; sort?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isDancer = profile?.role === "dancer";
  const params = await searchParams;

  const hasFilters = !!(params.style || params.type || params.q);

  const sort = params.sort ?? "newest";

  let query = supabase
    .from("jobs")
    .select("*, recruiter:recruiter_profiles(company_name, is_verified)")
    .eq("status", "open");

  // Role type filter
  if (params.type) query = query.eq("role_type", params.type);

  // Style filter — overlaps array column
  if (params.style) query = query.contains("styles_needed", [params.style]);

  // Sorting
  if (sort === "pay_high") {
    query = query.order("pay_range_max_cents", { ascending: false, nullsFirst: false });
  } else if (sort === "deadline_soon") {
    query = query
      .not("application_deadline", "is", null)
      .order("application_deadline", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data: rawJobs } = await query.limit(60);

  // Client-side text search (title match) applied after fetch
  const q = (params.q ?? "").toLowerCase().trim();
  const jobs = q
    ? (rawJobs ?? []).filter((j) => j.title.toLowerCase().includes(q))
    : (rawJobs ?? []);

  // Fetch saved job IDs for dancer users
  let savedJobIds = new Set<string>();
  if (isDancer) {
    const { data: dancerProfile } = await supabase
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (dancerProfile) {
      const { data: savedJobs } = await supabase
        .from("saved_jobs")
        .select("job_id")
        .eq("dancer_id", dancerProfile.id);
      savedJobIds = new Set((savedJobs ?? []).map((s) => s.job_id));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-1">
            {profile?.role === "recruiter" ? "My Job Posts" : "Open Roles"}
          </h1>
          <p className="text-white/40 text-sm">
            {profile?.role === "recruiter" ? "Manage your listings and review applications" : "Browse and apply to verified opportunities"}
          </p>
        </div>
        {profile?.role === "recruiter" && (
          <Link href="/dashboard/jobs/new" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-2.5 rounded-full text-sm transition-all shrink-0">
            <Plus className="w-4 h-4" />
            Post a Role
          </Link>
        )}
      </div>

      {/* All Jobs / Saved Jobs tabs — dancer only */}
      {isDancer && (
        <div className="flex gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl w-fit">
          <Link
            href="/dashboard/jobs"
            className="px-5 py-2 rounded-lg text-sm font-semibold transition-all bg-violet-600 text-white shadow"
          >
            All Jobs
          </Link>
          <Link
            href="/dashboard/jobs/saved"
            className="px-5 py-2 rounded-lg text-sm font-semibold transition-all text-white/50 hover:text-white hover:bg-white/5"
          >
            Saved
          </Link>
        </div>
      )}

      <JobsFilterBar />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job as unknown as Job}
            isDancer={isDancer}
            initialSaved={savedJobIds.has(job.id)}
          />
        ))}
        {jobs.length === 0 && (
          <div className="col-span-full text-center py-20">
            <div className="text-5xl mb-4">🎭</div>
            <h3 className="text-lg font-semibold mb-2">No jobs found</h3>
            <p className="text-white/40 text-sm mb-6">
              {hasFilters ? "Try removing some filters to see more listings." : "No jobs have been posted yet. Check back soon!"}
            </p>
            {hasFilters && (
              <Link href="/dashboard/jobs" className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-semibold transition-colors inline-block">
                Clear Filters
              </Link>
            )}
            {!hasFilters && profile?.role === "recruiter" && (
              <Link href="/dashboard/jobs/new" className="mt-4 inline-block text-violet-400 hover:text-violet-300 text-sm transition-colors">
                Post your first role →
              </Link>
            )}
          </div>
        )}
      </div>
      {jobs.length > 0 && (
        <p className="text-xs text-white/30">{jobs.length} role{jobs.length !== 1 ? "s" : ""} found</p>
      )}
    </div>
  );
}
