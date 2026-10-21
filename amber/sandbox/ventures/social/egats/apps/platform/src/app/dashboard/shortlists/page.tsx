export const revalidate = 60;
export const metadata = { title: 'EGATS | Shortlists', robots: 'noindex' };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Bookmark, Users, Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default async function ShortlistsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
  const { data: shortlists } = await supabase
    .from("shortlists")
    .select("*, job:jobs(title)")
    .eq("recruiter_id", recruiter?.id || "")
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1">Shortlists</h1>
          <p className="text-white/40 text-sm">Your curated talent pools</p>
        </div>
        <Link href="/dashboard/dancers" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-2.5 rounded-full text-sm transition-all">
          <Plus className="w-4 h-4" />
          Build New Shortlist
        </Link>
      </div>

      {shortlists?.length ? (
        <div className="grid md:grid-cols-2 gap-4">
          {shortlists.map((sl) => (
            <Link key={sl.id} href={`/dashboard/shortlists/${sl.id}`} className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 card-hover block hover:bg-white/[0.06] transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-base mb-1">{sl.name}</h3>
                  {sl.job && <div className="text-xs text-white/40">For: {(sl.job as { title: string }).title}</div>}
                </div>
                <Bookmark className="w-4 h-4 text-violet-400" />
              </div>
              <div className="flex items-center gap-4 text-sm text-white/40">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  {sl.dancer_ids.length} dancer{sl.dancer_ids.length !== 1 ? "s" : ""}
                </div>
                <div>Updated {formatDate(sl.updated_at)}</div>
              </div>
              {sl.notes && (
                <p className="mt-4 text-sm text-white/50 border-t border-white/5 pt-4">{sl.notes}</p>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">📋</div>
          <h3 className="text-lg font-semibold mb-2">No shortlists yet</h3>
          <p className="text-white/40 text-sm mb-6">Browse dancers and save your favorites to create a shortlist.</p>
          <a href="/dashboard/dancers" className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-semibold transition-colors inline-block">
            Browse Dancers
          </a>
        </div>
      )}
    </div>
  );
}
