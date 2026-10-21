import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  BarChart3,
  MessageSquare,
  Users,
  GitBranch,
  AlertTriangle,
  Mail,
  Shuffle,
  Search,
  Building2,
  UserCheck,
  ClipboardList,
  TrendingUp,
  Layers,
  BookOpen,
  Award,
  Monitor,
  Heart,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

function MarrowMark({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="5" cy="5" r="3" fill="currentColor" />
      <circle cx="19" cy="5" r="3" fill="currentColor" />
      <circle cx="5" cy="19" r="3" fill="currentColor" />
      <circle cx="19" cy="19" r="3" fill="currentColor" />
      <rect x="7" y="11" width="10" height="2" rx="1" fill="currentColor" />
      <rect x="4" y="7" width="2" height="10" rx="1" fill="currentColor" />
      <rect x="18" y="7" width="2" height="10" rx="1" fill="currentColor" />
    </svg>
  )
}

const mockupRows = [
  { initials: 'AK', stage: 'Interview', score: '4.8' },
  { initials: 'TM', stage: 'First Round', score: '4.2' },
  { initials: 'RC', stage: 'Application', score: null },
  { initials: 'JP', stage: 'Interview', score: '3.9' },
]

const stageDotColor: Record<string, string> = {
  Interview: 'bg-indigo-400',
  'First Round': 'bg-amber-400',
  Application: 'bg-stone-300',
}

function DashboardMockup() {
  return (
    <div
      className="relative w-full max-w-2xl mx-auto hidden sm:block"
      role="img"
      aria-label="Marrow applicant pipeline dashboard showing 84 applications, stage breakdown, and reviewer scores"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-indigo-100/70 to-transparent blur-2xl rounded-3xl -z-10" />
      <div className="relative rounded-2xl border border-stone-200 bg-white shadow-xl overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 bg-stone-50 border-b border-stone-200">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-stone-300" />
            <div className="w-3 h-3 rounded-full bg-stone-300" />
            <div className="w-3 h-3 rounded-full bg-stone-300" />
          </div>
          <div className="flex-1 mx-4 h-6 rounded-md bg-stone-200/80 flex items-center px-3">
            <span className="text-xs text-stone-500 font-mono">
              marrow.app/your-org/spring-2026
            </span>
          </div>
        </div>

        <div className="flex h-[320px]">
          {/* Sidebar */}
          <div className="w-44 border-r border-stone-100 bg-stone-50/50 p-3 flex flex-col gap-1 shrink-0">
            <div className="px-2 py-1.5 rounded-md bg-indigo-50 flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-xs font-medium text-indigo-700">Pipeline</span>
            </div>
            {[
              { label: 'Applicants', Icon: Users },
              { label: 'Reviews', Icon: ClipboardList },
              { label: 'Messages', Icon: MessageSquare },
              { label: 'Analytics', Icon: BarChart3 },
            ].map((item) => (
              <div
                key={item.label}
                className="px-2 py-1.5 rounded-md flex items-center gap-2 text-stone-500"
              >
                <item.Icon className="w-3.5 h-3.5 text-stone-400" />
                <span className="text-xs">{item.label}</span>
              </div>
            ))}
            <div className="mt-auto pt-3 border-t border-stone-200">
              <div className="px-2 py-1 text-xs font-semibold text-stone-400 uppercase tracking-wide">
                Spring 2026
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-xs text-stone-500">Open</span>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 p-4 overflow-hidden">
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: 'Applications', value: '84', color: 'text-indigo-600' },
                { label: 'Under Review', value: '31', color: 'text-amber-600' },
                { label: 'Moving Forward', value: '12', color: 'text-green-600' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-stone-50 rounded-lg p-2.5 border border-stone-100"
                >
                  <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-stone-500">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="grid grid-cols-3 px-2 mb-1">
                <span className="text-[10px] text-stone-400 col-span-2">Applicant</span>
                <span className="text-[10px] text-stone-400 text-right">Score</span>
              </div>
              {mockupRows.map((row) => (
                <div key={row.initials} className="flex items-center gap-3 p-2 rounded-md">
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-indigo-700">{row.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-stone-400">{row.stage}</div>
                  </div>
                  {row.score ? (
                    <span className="text-[10px] font-medium text-stone-600 tabular-nums">
                      {row.score}
                    </span>
                  ) : (
                    <span className="text-[10px] text-stone-300 tabular-nums">--</span>
                  )}
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${stageDotColor[row.stage] ?? 'bg-stone-300'}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Skip nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-indigo-600 focus:rounded-lg focus:shadow-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Nav */}
      <nav
        aria-label="Main navigation"
        className="fixed top-0 inset-x-0 z-50 border-b border-stone-100 bg-white/90 backdrop-blur-md"
      >
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <MarrowMark className="text-stone-900" />
            <span className="font-semibold text-stone-900 tracking-tight text-sm">Marrow</span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-stone-500">
            <a href="#problem" className="hover:text-stone-900 transition-colors">
              Why Marrow
            </a>
            <a href="#how" className="hover:text-stone-900 transition-colors">
              How it works
            </a>
            <a href="#features" className="hover:text-stone-900 transition-colors">
              Features
            </a>
            <a href="#faq" className="hover:text-stone-900 transition-colors">
              FAQ
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="text-stone-600 hover:text-stone-900">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4">
              <Link href="/signup">Get started free</Link>
            </Button>
          </div>
        </div>
      </nav>

      <main id="main-content">
        {/* Hero */}
        <section id="hero" className="relative pt-32 pb-24 border-b border-stone-100">
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-50/60 to-white -z-10" />
          <div className="relative max-w-6xl mx-auto px-6">
            <div className="text-center mb-8">
              <h1 className="text-5xl md:text-6xl lg:text-[68px] font-bold tracking-tight text-stone-900 leading-none mb-6">
                Club recruiting without
                <br className="hidden md:block" />
                {' '}<span className="text-indigo-600">Google Forms and spreadsheets</span>
              </h1>

              <p className="text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed mb-10">
                A single place to manage applications, run structured reviews, and track decisions
                across every cycle.
              </p>

              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Button
                  size="lg"
                  asChild
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-8 h-11 text-sm font-medium"
                >
                  <Link href="/signup">
                    Get started free
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  asChild
                  className="rounded-lg px-8 h-11 text-sm font-medium border-stone-200 text-stone-700 hover:bg-stone-50"
                >
                  <a href="#how">See how it works</a>
                </Button>
              </div>

              <p className="mt-4 text-sm text-stone-500">
                Free for student organizations. No credit card required.
              </p>
            </div>

            <DashboardMockup />
          </div>
        </section>

        {/* Problem */}
        <section id="problem" className="py-24 bg-stone-50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-stone-900 mb-4">
                The existing tools weren&apos;t built for this
              </h2>
              <p className="text-lg text-stone-600 max-w-2xl mx-auto">
                Most clubs run recruiting across Google Forms, a shared spreadsheet, and a shared
                doc nobody updates. None of these tools were designed for multi-stage recruiting.
                The patched-together result breaks under pressure every cycle.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: FileText,
                  title: 'Responses scattered across forms and tabs',
                  description:
                    'One Google Form per stage, with responses dumping into separate tabs. No unified view, no way to track a candidate across rounds.',
                },
                {
                  icon: Mail,
                  title: 'Interview invites sent by hand',
                  description:
                    'Copying and pasting emails to every applicant. Someone gets missed. Confirmations are never tracked. Follow-ups are forgotten.',
                },
                {
                  icon: Shuffle,
                  title: 'Reviewers score without a shared rubric',
                  description:
                    'One reviewer weights leadership heavily; another cares about GPA. No way to reconcile, compare, or calibrate across your committee.',
                },
                {
                  icon: Search,
                  title: 'No continuity between cycles',
                  description:
                    "A strong applicant from last semester doesn't exist when this semester starts. Every cycle begins from scratch.",
                },
                {
                  icon: Users,
                  title: 'Leadership has no visibility',
                  description:
                    "No way to see where the process stands until it's almost over. Status updates come from Slack messages and someone's best guess.",
                },
                {
                  icon: AlertTriangle,
                  title: 'The master sheet always breaks',
                  description:
                    'Someone maintains a Google Sheet that is always slightly out of date and one formula edit away from losing everything.',
                },
              ].map((pain) => (
                <div
                  key={pain.title}
                  className="p-6 rounded-xl border border-stone-200 bg-white"
                >
                  <div className="w-9 h-9 rounded-lg bg-stone-100 flex items-center justify-center mb-4">
                    <pain.icon className="w-4 h-4 text-stone-600" />
                  </div>
                  <h3 className="font-semibold text-stone-900 mb-2 text-sm">{pain.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{pain.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-stone-900 mb-4">How it works</h2>
              <p className="text-lg text-stone-600 max-w-lg mx-auto">
                Set up once. Run every cycle from the same foundation.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  step: '01',
                  title: 'Build your cycle',
                  description:
                    'Create your portal, define your stages, and configure the rubric for each. Publish and reuse it each semester without starting over.',
                },
                {
                  step: '02',
                  title: 'Applicants submit, your team reviews',
                  description:
                    'Applicants submit through your portal. Reviewers score each submission against the rubric, leave notes, and advance or reject. Every action is tracked.',
                },
                {
                  step: '03',
                  title: 'Decide, then onboard',
                  description:
                    'Send acceptance or rejection emails in bulk. Accepted members complete the onboarding tasks you configure. All data carries over to the next cycle.',
                },
              ].map((step, i) => (
                <div
                  key={step.step}
                  className="relative rounded-2xl border border-stone-200 bg-stone-50 p-8 shadow-sm"
                >
                  <div className="text-3xl font-bold text-indigo-200 mb-4">{step.step}</div>
                  <h3 className="text-lg font-bold text-stone-900 mb-3">{step.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{step.description}</p>
                  {i < 2 && (
                    <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white rounded-full border border-stone-200 items-center justify-center shadow-sm">
                      <ArrowRight className="w-4 h-4 text-stone-400" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-24 bg-stone-50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-stone-900 mb-4">The full recruiting toolkit</h2>
              <p className="text-lg text-stone-600">
                Everything runs natively. No integrations needed.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: GitBranch,
                  title: 'Pipeline',
                  description:
                    'Move applicants through any stages you define with bulk actions, status filters, and a complete history of every move.',
                },
                {
                  icon: ClipboardList,
                  title: 'Structured Review',
                  description:
                    "Define weighted scoring criteria per stage. Reviewers score against the rubric before results are compiled, so no reviewer is influenced by others' scores.",
                },
                {
                  icon: FileText,
                  title: 'Application Builder',
                  description:
                    'Build custom forms for each stage with any combination of field types, word limits, and required fields.',
                },
                {
                  icon: Search,
                  title: 'Applicant History',
                  description:
                    'Every applicant and every submission, searchable across all cycles. An applicant who applied last semester is still in the system when the next cycle opens.',
                },
                {
                  icon: MessageSquare,
                  title: 'Bulk Messaging',
                  description:
                    'Send targeted emails to all applicants, a specific stage, or selected individuals. Track delivery and carry templates into the next cycle.',
                },
                {
                  icon: BarChart3,
                  title: 'Analytics',
                  description:
                    'Stage conversion rates, reviewer score distributions, and application timelines. See where you lose applicants at each stage and where reviewers disagree.',
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="p-6 rounded-xl border border-stone-200 bg-white shadow-sm hover:border-indigo-300 hover:shadow-md transition-[border-color,box-shadow] duration-200"
                >
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center mb-4">
                    <feature.icon className="w-4 h-4 text-indigo-600" />
                  </div>
                  <h3 className="font-semibold text-stone-900 mb-2 text-base">{feature.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Per-persona */}
        <section className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-stone-900 mb-4">
                Designed for every role in the process
              </h2>
              <p className="text-lg text-stone-600 max-w-lg mx-auto">
                From first submission to final decision.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  audience: 'For organizations',
                  Icon: Building2,
                  title: 'One system for your entire process',
                  points: [
                    'Custom application portal with your branding',
                    'Each stage has its own form and rubric',
                    'Reviewers score independently at each stage',
                    'Send bulk emails to all applicants or any group',
                    'Analytics and full CSV export at any time',
                  ],
                },
                {
                  audience: 'For applicants',
                  Icon: UserCheck,
                  title: 'A clear, consistent experience',
                  points: [
                    'One place to apply, check status, and see results',
                    'Mobile-friendly portal that works on any device',
                    'Status updates at every stage transition',
                    'Resume uploads and portfolio or GitHub links',
                    'Automatic emails for confirmations, reminders, and deadlines',
                  ],
                },
                {
                  audience: 'For reviewers',
                  Icon: Users,
                  title: 'Structure that removes guesswork',
                  points: [
                    'Rubric-based scoring with weighted criteria',
                    'Optional blind mode that hides names until you submit',
                    'Peer scores visible only after you submit yours',
                    'Comments tied to specific application answers',
                    'Advance or reject with a complete audit trail',
                  ],
                },
              ].map((card) => (
                <div
                  key={card.audience}
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-8 flex flex-col"
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center mb-4">
                    <card.Icon className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">
                    {card.audience}
                  </div>
                  <h3 className="text-lg font-bold text-stone-900 mb-4">{card.title}</h3>
                  <ul className="space-y-3 flex-1">
                    {card.points.map((point) => (
                      <li key={point} className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                        <span className="text-sm text-stone-600">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Who it's for */}
        <section id="who" className="py-24 bg-stone-50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-stone-900 mb-4">Who Marrow is built for</h2>
              <p className="text-lg text-stone-600 max-w-xl mx-auto">
                Any club running applicants through more than one round.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  Icon: TrendingUp,
                  title: 'Consulting clubs',
                  description:
                    'Multi-round pipeline with a written application, case screening, and behavioral interview. Shared rubrics across a review committee of any size.',
                },
                {
                  Icon: Layers,
                  title: 'Finance societies',
                  description:
                    'Technical screens, modeling tests, and behavioral rounds, all scored on a shared rubric. Score calibration keeps every reviewer aligned to the same standard.',
                },
                {
                  Icon: BookOpen,
                  title: 'Pre-med and research orgs',
                  description:
                    'Structured evaluation, document collection, and post-acceptance onboarding tasks tracked alongside the application in one cycle.',
                },
                {
                  Icon: Monitor,
                  title: 'Tech clubs',
                  description:
                    'Portfolio and GitHub link collection, project-based evaluation, and rubric-based scoring. Handle any technical review workflow without spreadsheets.',
                },
                {
                  Icon: Heart,
                  title: 'Service and nonprofit orgs',
                  description:
                    'Interest screening, onboarding forms, and commitment sign-offs for organizations where membership commitment level matters.',
                },
                {
                  Icon: Award,
                  title: 'Honors societies',
                  description:
                    'GPA screening, writing sample collection, and committee review workflows for organizations with selective membership.',
                },
              ].map((useCase) => (
                <div
                  key={useCase.title}
                  className="p-6 rounded-xl border border-stone-200 bg-white hover:shadow-sm transition-shadow duration-200"
                >
                  <div className="w-9 h-9 rounded-lg bg-stone-100 flex items-center justify-center mb-4">
                    <useCase.Icon className="w-4 h-4 text-stone-600" />
                  </div>
                  <h3 className="font-semibold text-stone-900 mb-2 text-sm">{useCase.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{useCase.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-24 bg-white">
          <div className="max-w-4xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-stone-900 mb-3">Questions</h2>
              <p className="text-lg text-stone-500">Answers to the most common ones.</p>
            </div>

            <div className="space-y-4">
              {[
                {
                  q: 'Is Marrow really free?',
                  a: "Yes. The core workflow (applications, pipeline, structured review, and messaging) is free for student organizations and will stay free.",
                },
                {
                  q: 'Who can see applicant submissions?',
                  a: "Application data is visible only to members of your organization with reviewer or admin access. We don't share data between organizations. You can export or delete all records at any time.",
                },
                {
                  q: 'What happens to data from previous cycles?',
                  a: "Your data stays. Every applicant who has ever applied to your organization is in the system, searchable, and available to your team when they reapply. We don't delete anything at semester end.",
                },
                {
                  q: 'How is this different from Google Forms and a spreadsheet?',
                  a: "Google Forms handles a single form. Marrow handles an entire multi-stage process: pipelines, rubric-based reviewer scoring, bulk messaging, applicant history across cycles, and analytics, without stitching together multiple tools that weren't designed to work together.",
                },
                {
                  q: 'Can multiple reviewers score the same application?',
                  a: "Yes. Assign any number of reviewers to a stage. Each reviewer scores independently against the rubric. Scores become visible after each reviewer submits, so early reviewers don't influence later ones.",
                },
                {
                  q: 'Do applicants need to create an account?',
                  a: 'Yes. Applicants create a free Marrow account to submit and track their application. The account lets them check their status, receive updates, and apply to other organizations using Marrow.',
                },
              ].map((faq) => (
                <div key={faq.q} className="rounded-xl border border-stone-200 bg-stone-50/50 p-6">
                  <p className="font-semibold text-stone-900 mb-2 text-base">{faq.q}</p>
                  <p className="text-sm text-stone-500 leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 pt-8 border-t border-stone-100 text-center text-sm text-stone-500">
              Still have a question?{' '}
              <a
                href="mailto:hello@marrow.app"
                className="text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                Send us a message.
              </a>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-28 bg-stone-900">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-5 leading-tight">
              Run every recruiting cycle on Marrow
            </h2>
            <p className="text-stone-400 text-lg mb-10">
              Set up your first cycle today. Free for student organizations.
            </p>

            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Button
                size="lg"
                asChild
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-10 h-12 text-base font-medium"
              >
                <Link href="/signup">
                  Get started free
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button variant="ghost" size="lg" asChild className="text-stone-400 hover:text-stone-200 hover:bg-transparent">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        role="contentinfo"
        className="bg-stone-950 border-t border-stone-700 text-stone-400 py-10"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-10 mb-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <MarrowMark className="text-stone-400" />
                <span className="font-semibold text-white tracking-tight text-sm">Marrow</span>
              </div>
              <p className="text-sm leading-relaxed max-w-sm">
                Application management, structured review, and cycle analytics for student
                organizations.
              </p>
            </div>

            <nav aria-label="Product links">
              <div className="text-white font-semibold text-sm mb-4">Product</div>
              <ul className="space-y-2.5 list-none">
                {[
                  { label: 'Pipeline', href: '/#features' },
                  { label: 'Structured Review', href: '/#features' },
                  { label: 'Application Builder', href: '/#features' },
                  { label: 'Bulk Messaging', href: '/#features' },
                  { label: 'Analytics', href: '/#features' },
                ].map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-stone-500 hover:text-stone-300 transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Company links">
              <div className="text-white font-semibold text-sm mb-4">Legal</div>
              <ul className="space-y-2.5 list-none">
                {[
                  { label: 'Privacy Policy', href: '/privacy' },
                  { label: 'Terms of Service', href: '/terms' },
                  { label: 'Contact', href: 'mailto:hello@marrow.app' },
                ].map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-stone-500 hover:text-stone-300 transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="pt-8 border-t border-stone-800 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-stone-500">&copy; 2026 Marrow.</p>
            <Button size="sm" asChild className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 text-xs h-8">
              <Link href="/signup">Get started free</Link>
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}
