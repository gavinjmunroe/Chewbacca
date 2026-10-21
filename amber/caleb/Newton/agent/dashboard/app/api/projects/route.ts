import { NextRequest, NextResponse } from "next/server";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  private: boolean;
  html_url: string;
  updated_at: string;
  pushed_at: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
}

export async function GET(req: NextRequest) {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GitHub not configured." },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const perPage = parseInt(searchParams.get("perPage") || "30");

    // Single page fetch (fast, works within Vercel timeout)
    const res = await fetch(
      `https://api.github.com/user/repos?sort=updated&per_page=${Math.min(perPage, 100)}&page=${page}&type=owner`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { error: `GitHub API error: ${res.status}` },
        { status: 502 },
      );
    }

    const raw: GitHubRepo[] = await res.json();
    const hasMore = raw.length === Math.min(perPage, 100);

    const repos = raw.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      language: r.language,
      isPrivate: r.private,
      url: r.html_url,
      updatedAt: r.updated_at,
      pushedAt: r.pushed_at,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      defaultBranch: r.default_branch,
    }));

    return NextResponse.json({ repos, total: repos.length, page, hasMore });
  } catch (err) {
    console.error("[projects]", err);
    return NextResponse.json(
      { error: "Failed to load projects." },
      { status: 500 },
    );
  }
}
