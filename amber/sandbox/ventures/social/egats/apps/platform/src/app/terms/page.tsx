import Link from "next/link";

export const metadata = {
  title: "Terms of Service | EGATS",
  description: "EGATS Platform Terms of Service",
};

const SECTIONS = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    content: `By accessing or using the EGATS platform ("Platform," "Service," or "EGATS"), you agree to be bound by these Terms of Service ("Terms") and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing the Platform.

These Terms apply to all visitors, users, and others who access or use the Service, including dancers, recruiters, verifiers, and administrators. EGATS reserves the right to update these Terms at any time. We will notify users of significant changes via email or in-platform notification. Your continued use of the Platform after such changes constitutes your acceptance of the new Terms.`,
  },
  {
    id: "description",
    title: "2. Platform Description",
    content: `EGATS is a professional talent discovery and booking platform that connects dancers with recruiters, production companies, brands, and entertainment industry professionals. The Platform provides:

• **Talent Profiles**: Dancers create profiles showcasing their skills, portfolio clips, and availability.
• **Verification System**: A tiered verification process (Camp Attendee, Verified Human, EGATS Verified Talent) that authenticates dancer identities and validates skill levels through in-person evaluation camps.
• **Job Listings & Applications**: Recruiters post opportunities; dancers discover and apply to relevant jobs.
• **Booking Management**: End-to-end management of confirmed engagements, including contracts and payment coordination.
• **Culture Feed**: A community space for dancers to share content, participate in challenges, and engage with the broader dance community.
• **EGATS Camps**: Structured in-person evaluation events that serve as both skill assessment and community-building gatherings.

EGATS is not an employment agency. We facilitate connections between independent contractors (dancers) and those seeking their services, but we are not a party to any employment or service agreement formed through the Platform.`,
  },
  {
    id: "accounts",
    title: "3. User Accounts",
    content: `**Account Creation**
To access most features of EGATS, you must create an account. You must provide accurate, current, and complete information during registration and keep your account information updated. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.

**Dancer Accounts**
Dancers agree to: (a) represent themselves honestly and accurately, including their skill levels, experience, and availability; (b) submit only authentic, original portfolio content; (c) honor confirmed bookings and communicate promptly with recruiters; (d) participate in the verification process honestly and in good faith.

**Recruiter Accounts**
Recruiters agree to: (a) represent their company, production, or project accurately; (b) post only legitimate, real job opportunities; (c) communicate respectfully and professionally with dancers; (d) honor the terms of confirmed bookings and pay agreed compensation on time; (e) not use dancer information obtained through EGATS for purposes unrelated to the stated booking opportunity.

**Account Termination**
You may delete your account at any time through your account settings. EGATS may suspend or terminate your account for violations of these Terms, suspected fraudulent activity, or any conduct that EGATS determines is harmful to the Platform or its users.`,
  },
  {
    id: "verification",
    title: "4. Verification System",
    content: `EGATS operates a three-tier verification system to establish trust and authenticity within the platform:

**Tier 0: Camp Attendee**: Awarded to dancers who have attended an EGATS evaluation camp. Confirms physical attendance and baseline participation.

**Tier 1: Verified Human**: Awarded following identity verification. Confirms that the dancer is a real person whose identity matches their platform profile.

**Tier 2: EGATS Verified Talent**: The highest verification tier, awarded by certified EGATS verifiers following an in-person evaluation. Encompasses assessment of technique, learning speed, professionalism, collaboration, on-camera presence, and communication. Tier 2 status may expire and is subject to renewal.

Verification status is tied to EGATS evaluations only. EGATS does not independently verify external credentials, prior professional experience, or representations made in a dancer's bio. Verification scores and notes collected during evaluations are used solely to award verification tiers and may be shared with recruiters in aggregate form as part of the dancer's profile.

EGATS reserves the right to revoke verification status if fraudulent activity is discovered or if a dancer's conduct materially contradicts their verified profile.`,
  },
  {
    id: "booking",
    title: "5. Booking & Payments",
    content: `**Booking Process**
A booking is confirmed when both the recruiter and dancer have accepted the terms of an engagement through the Platform. Confirmed bookings create a binding obligation for both parties.

**Platform Fees**
EGATS charges a platform fee on completed bookings, which is disclosed at the time of booking confirmation. EGATS reserves the right to modify its fee structure with reasonable notice to users.

**Payment Processing**
All payments are processed through EGATS's designated payment processors. EGATS is not responsible for delays, errors, or failures caused by third-party payment processors. Dancers are responsible for all applicable taxes on income earned through the Platform.

**Cancellations & Disputes**
Cancellation policies are set at the booking level and agreed upon by both parties at the time of confirmation. In the event of a dispute, both parties agree to first attempt resolution through EGATS's built-in dispute resolution process before pursuing external legal remedies.

**No Guarantee of Work**
EGATS does not guarantee that dancers will receive bookings or that recruiters will find suitable talent. The Platform provides tools and infrastructure; outcomes depend on the individual parties.`,
  },
  {
    id: "conduct",
    title: "6. Code of Conduct",
    content: `All users of EGATS are expected to conduct themselves professionally and respectfully. The following standards apply to all interactions on the Platform:

• Treat all users with dignity and respect regardless of race, ethnicity, gender, sexual orientation, disability, nationality, or any other protected characteristic.
• Communicate honestly and transparently in all professional interactions.
• Respond to messages and booking inquiries within a reasonable timeframe.
• Honor confirmed commitments. Last-minute cancellations harm the entire ecosystem.
• Provide constructive, honest feedback in reviews. Defamatory, retaliatory, or false reviews violate these Terms.
• Protect the privacy of others. Do not share private communications, personal information, or confidential details without consent.

Repeated violations of the Code of Conduct may result in temporary suspension or permanent ban from the Platform.`,
  },
  {
    id: "prohibited",
    title: "7. Prohibited Activities",
    content: `The following activities are strictly prohibited on EGATS:

• Creating fake profiles, impersonating other individuals, or misrepresenting your identity, skills, or credentials.
• Submitting fraudulent portfolio clips that do not feature you or that misrepresent your abilities.
• Using the Platform to solicit or distribute spam, pyramid schemes, or unsolicited commercial communications.
• Attempting to circumvent the Platform's payment systems to conduct transactions off-platform and avoid fees (after initial introduction through EGATS).
• Scraping, crawling, or using automated tools to extract data from the Platform without express written permission.
• Uploading content that infringes on the intellectual property rights of others.
• Uploading content that is defamatory, obscene, sexually explicit without proper consent indicators, or otherwise unlawful.
• Attempting to hack, disrupt, or otherwise interfere with the Platform's technical infrastructure.
• Using EGATS to facilitate human trafficking, exploitation, or any other illegal activity.

Violations may result in immediate account termination and, where appropriate, referral to law enforcement.`,
  },
  {
    id: "privacy",
    title: "8. Privacy",
    content: `Your privacy is important to us. Our Privacy Policy, available at egats.com/privacy, describes how we collect, use, and share information about you when you use our Services. By using EGATS, you agree to the collection and use of information in accordance with our Privacy Policy.

Key privacy commitments:
• We do not sell your personal data to third parties.
• Portfolio clips and profile content you mark as public are visible to all users. Content marked private is visible only to you and those you explicitly authorize.
• Verification data (scores, evaluator notes) is handled with strict access controls and is shared only in the context of your platform profile.`,
  },
  {
    id: "ip",
    title: "9. Intellectual Property",
    content: `**Your Content**
You retain ownership of all content you upload to EGATS, including portfolio clips, profile photographs, and written descriptions. By uploading content to EGATS, you grant EGATS a non-exclusive, royalty-free, worldwide license to host, display, and distribute that content for the purpose of operating the Platform and, with your separate opt-in consent, for EGATS marketing materials.

**EGATS IP**
The EGATS name, logo, platform design, software, algorithms, and all related intellectual property are owned by EGATS and are protected by copyright, trademark, and other applicable laws. You may not use EGATS's name or branding without written permission.

**DMCA**
EGATS respects intellectual property rights and expects users to do the same. If you believe your copyrighted work has been infringed on the Platform, please contact us at legal@egats.com with a DMCA-compliant takedown notice.`,
  },
  {
    id: "disclaimers",
    title: "10. Disclaimers",
    content: `THE EGATS PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.

EGATS DOES NOT WARRANT THAT: (A) THE PLATFORM WILL MEET YOUR REQUIREMENTS; (B) THE PLATFORM WILL BE UNINTERRUPTED, TIMELY, SECURE, OR ERROR-FREE; (C) THE RESULTS OBTAINED FROM THE USE OF THE PLATFORM WILL BE ACCURATE OR RELIABLE; OR (D) THE QUALITY OF ANY SERVICES, INFORMATION, OR OTHER MATERIAL OBTAINED THROUGH THE PLATFORM WILL MEET YOUR EXPECTATIONS.

EGATS does not endorse, warrant, or guarantee any dancer, recruiter, or other third-party user. The verification system is designed to increase trust, but it does not constitute a guarantee of professional performance, personal conduct, or any other outcome.`,
  },
  {
    id: "liability",
    title: "11. Limitation of Liability",
    content: `TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, EGATS AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AND LICENSORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION, LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM: (I) YOUR ACCESS TO OR USE OF OR INABILITY TO ACCESS OR USE THE SERVICE; (II) ANY CONDUCT OR CONTENT OF ANY THIRD PARTY ON THE SERVICE; (III) ANY CONTENT OBTAINED FROM THE SERVICE; OR (IV) UNAUTHORIZED ACCESS, USE, OR ALTERATION OF YOUR TRANSMISSIONS OR CONTENT.

IN NO EVENT SHALL EGATS'S TOTAL LIABILITY TO YOU FOR ALL CLAIMS EXCEED THE AMOUNT YOU PAID TO EGATS, IF ANY, IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.`,
  },
  {
    id: "termination",
    title: "12. Termination",
    content: `EGATS may terminate or suspend your access to the Service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach these Terms.

Upon termination: (a) your right to use the Platform will immediately cease; (b) EGATS may delete your account and all associated data in accordance with our data retention policy; (c) all provisions of these Terms which by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.

You may terminate your account at any time by contacting support@egats.com or using the account deletion feature in settings. Termination does not relieve you of any outstanding obligations under confirmed bookings.`,
  },
  {
    id: "governing",
    title: "13. Governing Law",
    content: `These Terms shall be governed and construed in accordance with the laws of the State of California, United States, without regard to its conflict of law provisions.

Any disputes arising from or relating to these Terms or your use of the Platform shall be resolved through binding arbitration in Los Angeles, California, except that either party may seek injunctive relief in any court of competent jurisdiction to prevent irreparable harm pending arbitration. Class action lawsuits and class-wide arbitration are not permitted.

If any provision of these Terms is found invalid by a court of competent jurisdiction, the invalidity of that provision will not affect the validity of the remaining provisions, which will remain in full force and effect.`,
  },
  {
    id: "contact",
    title: "14. Contact",
    content: `If you have any questions about these Terms of Service, please contact us:

**Email**: legal@egats.com
**General Support**: support@egats.com
**Mailing Address**: EGATS Inc., Los Angeles, California, USA

For DMCA notices, please include all required statutory information in your communication to legal@egats.com.`,
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      {/* Nav breadcrumb */}
      <div className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-2 text-sm">
          <Link href="/" className="text-white/40 hover:text-white/70 transition-colors">
            EGATS
          </Link>
          <span className="text-white/20">/</span>
          <span className="text-white/60">Terms of Service</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-14">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Terms of Service</h1>
          <p className="text-white/40 text-sm">
            Last updated: <span className="text-white/60">March 2026</span>
          </p>
          <p className="text-white/50 text-base leading-relaxed mt-5 max-w-2xl">
            Please read these Terms of Service carefully before using the EGATS platform. By creating an account or using our services, you agree to be bound by these terms.
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
              <div className="text-white/60 text-[15px] leading-[1.8] space-y-4 whitespace-pre-line">
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
                        {line.replace(/\*\*(.+?)\*\*/g, (_, m) => m)}
                      </p>
                    );
                  }
                  if (line.trim() === "") return <div key={i} className="h-1" />;
                  return (
                    <p key={i}>
                      {line.replace(/\*\*(.+?)\*\*/g, (_, m) => m)}
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
            Questions?{" "}
            <a href="mailto:legal@egats.com" className="text-violet-400 hover:text-violet-300 transition-colors">
              legal@egats.com
            </a>
          </p>
          <Link href="/" className="inline-block mt-4 text-xs text-white/20 hover:text-white/40 transition-colors">
            Back to EGATS
          </Link>
        </div>
      </div>
    </div>
  );
}
