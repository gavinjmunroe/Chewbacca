import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | EGATS",
  description: "EGATS Platform Privacy Policy",
};

const SECTIONS = [
  {
    id: "introduction",
    title: "1. Introduction",
    content: `EGATS Inc. ("EGATS," "we," "our," or "us") is committed to protecting your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use the EGATS platform ("Platform" or "Service").

This policy applies to all users of the EGATS Platform, including dancers, recruiters, verifiers, and administrators. We encourage you to read this Privacy Policy carefully. If you disagree with its terms, please discontinue use of the Service.

Our data processing activities are conducted in compliance with applicable privacy laws, including the California Consumer Privacy Act (CCPA), the California Privacy Rights Act (CPRA), and, where applicable to our European users, the General Data Protection Regulation (GDPR).`,
  },
  {
    id: "collect",
    title: "2. Information We Collect",
    content: `**Information You Provide Directly**

• **Account Information**: When you register, we collect your email address, password (stored in hashed form via Supabase Auth), display name, role (dancer or recruiter), and optional profile details such as location, phone number, and social media handles.

• **Profile Content**: Dancers provide professional information including dance styles, years of experience, height, union/representation status, availability, and travel preferences. Recruiters provide company name, company type, and website.

• **Portfolio Clips**: Video URLs, thumbnail URLs, clip titles, descriptions, and style tags that you upload or link to your portfolio.

• **Verification Data**: During EGATS camp evaluations, verifiers collect skill assessment scores across defined dimensions (technique, learning speed, professionalism, collaboration, on-camera presence, communication), evaluator notes, and supporting clip URLs. This data is associated with your dancer profile.

• **Job Postings & Applications**: Recruiters provide job details, requirements, and compensation information. Dancers provide cover notes and selected clip submissions.

• **Messages & Communications**: Content of messages sent through the Platform between users.

• **Reviews**: Rating scores, dimension scores, and written review content.

**Information Collected Automatically**

• **Usage Data**: Pages viewed, features used, search queries, time spent on platform, and navigation paths.

• **Device Information**: IP address, browser type and version, operating system, device identifiers, and referring URLs.

• **Cookies and Similar Technologies**: Session tokens, authentication cookies, and analytics identifiers. See Section 6 for details.

**Information from Third Parties**

• **OAuth Providers**: If you sign up via a third-party authentication provider (such as Google), we receive your email address and display name as permitted by that service.

• **Payment Processors**: We receive transaction confirmation data from our payment processors but do not store full payment card numbers on our servers.`,
  },
  {
    id: "use",
    title: "3. How We Use Your Information",
    content: `We use the information we collect for the following purposes:

**Providing the Service**
• Creating and managing your account
• Displaying your profile to appropriate users based on your settings
• Facilitating job applications, bookings, and reviews
• Processing verification assessments and displaying verification tiers
• Enabling messaging between users

**Improving the Platform**
• Analyzing usage patterns to improve features and user experience
• Debugging and resolving technical issues
• Conducting internal research and analytics

**Communications**
• Sending transactional emails (booking confirmations, application updates, verification results)
• Notifying you of activity relevant to your account (new messages, application status changes)
• Sending service announcements and policy updates
• Sending optional marketing communications (with your consent, and unsubscribable at any time)

**Safety & Trust**
• Verifying user identities
• Investigating and preventing fraudulent activity, abuse, and violations of our Terms of Service
• Enforcing our Community Guidelines and Terms

**Legal Compliance**
• Complying with applicable laws and regulations
• Responding to lawful requests from public authorities`,
  },
  {
    id: "sharing",
    title: "4. Information Sharing",
    content: `**Profile Visibility**
Your public profile, including your display name, bio, location, portfolio clips (set to public), verification tier, and professional information, is visible to all registered EGATS users. You control the visibility settings for individual content items.

**Between Users**
When you apply to a job, the recruiter can see your profile, submitted clips, and cover note. When a booking is confirmed, both parties can see relevant contact and booking details. Reviews are associated with their authors' display names.

**Verification Data**
Aggregated verification scores are displayed as part of your public verification tier badge. Raw scores and evaluator notes are accessible to EGATS verifiers and administrators, and in summary form to recruiters viewing your profile (where enabled).

**Service Providers**
We share data with trusted third-party vendors who assist us in operating the Platform:
• **Supabase**: Our primary data infrastructure provider (database, authentication, storage). Supabase acts as a data processor under a data processing agreement with EGATS and does not use your data for purposes other than providing services to EGATS. Learn more at supabase.com/privacy.
• **Vercel**: Hosting and edge infrastructure for the Platform.
• **Payment Processors**: For handling booking payment transactions.
• **Analytics Providers**: For understanding platform usage (data is aggregated and anonymized where possible).
• **Email Service Providers**: For sending transactional and marketing emails.

**Business Transfers**
In the event of a merger, acquisition, reorganization, or sale of assets, your information may be transferred to the acquiring entity. We will notify you via email and/or a prominent notice on the Platform before your information becomes subject to a different privacy policy.

**Legal Requirements**
We may disclose your information if required to do so by law or in good faith belief that such disclosure is necessary to comply with a legal obligation, protect our rights, prevent fraud, or protect the safety of users.

**We Do Not Sell Your Data**
EGATS does not sell, rent, or trade your personal information to third parties for their own marketing purposes.`,
  },
  {
    id: "security",
    title: "5. Data Security",
    content: `We implement industry-standard technical and organizational security measures to protect your personal information, including:

• **Encryption in Transit**: All data transmitted between your browser and EGATS servers is encrypted using TLS (Transport Layer Security).
• **Encryption at Rest**: Database contents, including sensitive profile information, are encrypted at rest by our data infrastructure provider, Supabase.
• **Authentication**: Passwords are hashed using Supabase Auth's secure hashing algorithms. We never store plaintext passwords.
• **Access Controls**: Internal access to user data is limited to EGATS personnel with a legitimate business need. All access is logged.
• **Row-Level Security**: Our database enforces row-level security policies to ensure users can only access data they are authorized to view.

Despite these measures, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security. If you believe your account has been compromised, contact security@egats.com immediately.`,
  },
  {
    id: "cookies",
    title: "6. Cookies & Tracking Technologies",
    content: `EGATS uses the following types of cookies and similar technologies:

**Essential Cookies**
Required for the Platform to function. These include authentication session tokens that keep you logged in. You cannot opt out of essential cookies without also opting out of using the Service.

**Analytics Cookies**
Help us understand how users interact with the Platform (pages visited, features used, session duration). We use privacy-preserving analytics tools and do not use Google Analytics for core tracking.

**Preference Cookies**
Store your preferences such as UI settings and notification configurations.

**Managing Cookies**
You can control cookies through your browser settings. Blocking essential cookies will prevent you from logging in. Blocking analytics cookies will not affect your ability to use the Platform but limits our ability to improve the service.

We do not use third-party advertising cookies or cross-site tracking cookies.`,
  },
  {
    id: "rights",
    title: "7. Your Rights & Choices",
    content: `**For All Users**
• **Access**: You may request a copy of the personal data we hold about you.
• **Correction**: You may update most of your information directly through your account settings. Contact support for data you cannot edit yourself.
• **Deletion**: You may delete your account and request deletion of your personal data. Note that we may retain certain information as required by law or for legitimate business purposes (e.g., records of completed transactions).
• **Portability**: You may request an export of your data in a portable format.
• **Communication Preferences**: You may opt out of marketing emails at any time via the unsubscribe link or your notification settings. You cannot opt out of transactional emails (e.g., booking confirmations).

**California Residents (CCPA / CPRA)**
California residents have additional rights under the CCPA and CPRA:
• The right to know what personal information we collect, use, disclose, and sell (we do not sell).
• The right to delete personal information (subject to exceptions).
• The right to opt out of the sale or sharing of personal information (we do not sell or share for cross-context behavioral advertising).
• The right to correct inaccurate personal information.
• The right to limit use of sensitive personal information.
• The right to non-discrimination for exercising your privacy rights.

To exercise your California privacy rights, email privacy@egats.com with subject line "California Privacy Request."

**European Residents (GDPR)**
If you are located in the European Economic Area, you have rights under the GDPR including the right to access, rectification, erasure, restriction of processing, data portability, and the right to object to processing. Our legal bases for processing are: performance of a contract (providing the Service), legitimate interests (improving the Platform, preventing fraud), and consent (marketing communications).

To exercise your GDPR rights, contact privacy@egats.com. You also have the right to lodge a complaint with your local data protection authority.

To submit any privacy rights request, email privacy@egats.com. We will respond within 45 days (CCPA) or 30 days (GDPR).`,
  },
  {
    id: "retention",
    title: "8. Data Retention",
    content: `We retain your personal information for as long as your account is active or as needed to provide you with the Service. Specific retention periods:

• **Account Data**: Retained for the life of the account plus 90 days following deletion to allow for account recovery requests.
• **Booking Records**: Retained for 7 years following the completion or cancellation of a booking, as required for financial record-keeping.
• **Verification Records**: Retained for the duration of the verification tier validity period plus 2 years for dispute resolution purposes.
• **Messages**: Retained for 2 years following the last activity in a conversation.
• **Analytics Data**: Aggregated and anonymized after 13 months.
• **Deleted Content**: Removed from active systems within 30 days of deletion. Backup copies may persist for up to 90 additional days before being overwritten.

You may request earlier deletion of data that is not subject to mandatory retention. Contact privacy@egats.com.`,
  },
  {
    id: "children",
    title: "9. Children's Privacy",
    content: `EGATS is not directed to individuals under the age of 16. We do not knowingly collect personal information from children under 16. If we become aware that a child under 16 has provided us with personal information, we will take steps to delete such information.

Users between the ages of 16 and 18 may use the Platform, but recruiters are responsible for ensuring that any engagements comply with applicable child labor laws.

If you believe we have inadvertently collected information from a child under 16, please contact us at privacy@egats.com.`,
  },
  {
    id: "changes",
    title: "10. Changes to This Policy",
    content: `We may update this Privacy Policy from time to time. When we make material changes, we will notify you by:
• Sending an email to the address associated with your account, and/or
• Displaying a prominent notice on the Platform.

The "Last Updated" date at the top of this policy will always reflect the most recent version. We encourage you to review this Privacy Policy periodically.

Your continued use of the Platform after any changes to this Privacy Policy constitutes your acceptance of the revised terms. If you do not agree to the updated policy, you should stop using the Platform and may delete your account.`,
  },
  {
    id: "contact",
    title: "11. Contact",
    content: `If you have questions, concerns, or requests related to this Privacy Policy or our data practices, please contact us:

**Privacy Inquiries**: privacy@egats.com
**General Support**: support@egats.com
**Security Issues**: security@egats.com
**Mailing Address**: EGATS Inc., Los Angeles, California, USA

For GDPR-specific inquiries, our representative in the EU can be reached at eu-privacy@egats.com.

We will respond to all privacy inquiries within 30 days.`,
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      {/* Nav breadcrumb */}
      <div className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-2 text-sm">
          <Link href="/" className="text-white/40 hover:text-white/70 transition-colors">
            EGATS
          </Link>
          <span className="text-white/20">/</span>
          <span className="text-white/60">Privacy Policy</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-14">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-white/40 text-sm">
            Last updated: <span className="text-white/60">March 2026</span>
          </p>
          <p className="text-white/50 text-base leading-relaxed mt-5 max-w-2xl">
            EGATS is committed to protecting your privacy. This policy explains exactly what data we collect, why we collect it, and how you can control it.
          </p>
        </div>

        {/* Table of Contents */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 mb-14">
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-4">Contents</p>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="text-sm text-white/50 hover:text-violet-400 transition-colors py-0.5"
              >
                {s.title}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-14">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id}>
              <h2 className="text-xl font-bold text-white mb-4">{s.title}</h2>
              <div className="text-white/60 text-[15px] leading-[1.8] space-y-2">
                {s.content.split("\n").map((line, i) => {
                  if (line.startsWith("**") && line.endsWith("**")) {
                    return (
                      <p key={i} className="font-semibold text-white/80 mt-6 first:mt-0">
                        {line.replace(/\*\*/g, "")}
                      </p>
                    );
                  }
                  if (line.startsWith("• ")) {
                    return (
                      <p key={i} className="pl-4 border-l border-white/[0.08]">
                        {line.replace(/^• /, "").replace(/\*\*(.+?)\*\*/g, (_, m) => m)}
                      </p>
                    );
                  }
                  if (line.trim() === "") return <div key={i} className="h-1" />;
                  return (
                    <p key={i}>
                      {line.split(/\*\*(.+?)\*\*/).map((part, j) =>
                        j % 2 === 1 ? (
                          <strong key={j} className="text-white/80 font-semibold">{part}</strong>
                        ) : (
                          part
                        )
                      )}
                    </p>
                  );
                })}
              </div>
              <div className="mt-10 h-px bg-white/[0.05]" />
            </section>
          ))}
        </div>

        {/* Footer note */}
        <div className="mt-16 text-center">
          <p className="text-white/25 text-sm">
            Privacy questions?{" "}
            <a href="mailto:privacy@egats.com" className="text-violet-400 hover:text-violet-300 transition-colors">
              privacy@egats.com
            </a>
          </p>
          <div className="flex items-center justify-center gap-6 mt-4">
            <Link href="/terms" className="text-xs text-white/20 hover:text-white/40 transition-colors">
              Terms of Service
            </Link>
            <Link href="/" className="text-xs text-white/20 hover:text-white/40 transition-colors">
              Back to EGATS
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
