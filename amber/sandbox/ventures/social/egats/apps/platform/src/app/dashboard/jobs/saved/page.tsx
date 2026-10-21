export const revalidate = 0;
export const metadata = { title: 'EGATS | Saved Jobs', robots: 'noindex' };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import JobCard from "@/components/job-card";
import type { Job } from "@/types/database";

export default async function SavedJobsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  // Only dancers have saved jobs
  if (profile?.role !== "dancer") redirect("/dashboard/jobs");

  const { data: dancerProfile } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!dancerProfile) redirect("/dashboard/jobs");

  const { data: savedRows } = await supabase
    .from("saved_jobs")
    .select(`
      job_id,
      job:jobs(
        *,
        recruiter:recruiter_profiles(company_name, is_verified)
      )
    `)
    .eq("dancer_id", dancerProfile.id)
    .order("created_at", { ascending: false });

  const jobs: Job[] = (savedRows ?? [])
    .map((row) => row.job as unknown as Job)
    .filter(Boolean);

  // All shown jobs are saved
  const savedJobIds = new Set(jobs.map((j) => j.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-1">Saved Jobs</h1>
          <p className="text-white/40 text-sm">Jobs you&apos;ve bookmarked for later</p>
        </div>
      </div>

      {/* All Jobs / Saved Jobs tabs */}
      <div className="flex gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl w-fit">
        <Link
          href="/dashboard/jobs"
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-all text-white/50 hover:text-white hover:bg-white/5"
        >
          All Jobs
        </Link>
        <Link
          href="/dashboard/jobs/saved"
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-all bg-violet-600 text-white shadow"
        >
          Saved
        </Link>
      </div>

      {jobs.length ? (
        <>
          <p className="text-xs text-white/30">{jobs.length} saved role{jobs.length !== 1 ? "s" : ""}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isDancer={true}
                initialSaved={savedJobIds.has(job.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-20 text-white/30">
          <Bookmark className="w-10 h-10 mx-auto mb-4 opacity-20" />
          <p className="text-base mb-2">No saved jobs yet.</p>
          <p className="text-sm">Bookmark jobs you&apos;re interested in.</p>
          <Link
            href="/dashboard/jobs"
            className="mt-6 inline-block text-violet-400 hover:text-violet-300 text-sm transition-colors"
          >
            Browse open roles →
          </Link>
        </div>
      )}
    </div>
  );
}
