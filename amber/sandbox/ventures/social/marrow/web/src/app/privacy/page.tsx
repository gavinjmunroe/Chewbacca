import Link from 'next/link'

export const metadata = { title: 'Privacy Policy — Marrow' }

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-8">
          <Link href="/" className="text-sm text-stone-400 hover:text-stone-600">
            Marrow
          </Link>
          <h1 className="mt-4 text-3xl font-bold text-stone-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-stone-500">Last updated: March 2026</p>
        </div>

        <div className="prose prose-stone max-w-none text-stone-700 space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">1. Information We Collect</h2>
            <p>We collect information you provide directly, including:</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Account information (name, email address, profile details)</li>
              <li>Application content (responses, uploaded documents)</li>
              <li>Organization information (name, school, recruiting cycle data)</li>
              <li>Usage data (pages visited, actions taken within the Service)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">
              2. How We Use Your Information
            </h2>
            <p>We use collected information to:</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Operate and improve the Service</li>
              <li>Send transactional emails (application confirmations, status updates)</li>
              <li>Enable organizations to review and manage applications</li>
              <li>Ensure the security and integrity of the platform</li>
            </ul>
            <p className="mt-2">
              We do not sell your personal information to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">3. Information Sharing</h2>
            <p>
              Application content you submit is shared with the organization you apply to. Profile
              information may be visible to reviewers within that organization as part of the review
              process.
            </p>
            <p className="mt-2">
              We may share information with service providers who help us operate the platform
              (hosting, email delivery) under appropriate confidentiality agreements.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">4. Data Storage</h2>
            <p>
              Your data is stored using Supabase infrastructure. Files you upload are stored in
              secure cloud storage. We retain your data for as long as your account is active or as
              needed to provide the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">5. Your Rights</h2>
            <p>You may request to:</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Access or export a copy of your personal data</li>
              <li>Correct inaccurate information in your profile</li>
              <li>Delete your account and associated data</li>
            </ul>
            <p className="mt-2">
              To exercise these rights, contact us at{' '}
              <a
                href="mailto:hello@marrow.app"
                className="text-stone-900 underline underline-offset-2"
              >
                hello@marrow.app
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">6. Cookies</h2>
            <p>
              We use cookies and similar technologies to maintain your session and improve your
              experience. You can control cookies through your browser settings, though disabling
              them may affect functionality.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">7. Security</h2>
            <p>
              We implement reasonable technical and organizational measures to protect your data.
              However, no internet transmission is completely secure, and we cannot guarantee
              absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">8. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. We will notify you of material changes
              by email or through the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">9. Contact</h2>
            <p>
              Questions about this Privacy Policy? Contact us at{' '}
              <a
                href="mailto:hello@marrow.app"
                className="text-stone-900 underline underline-offset-2"
              >
                hello@marrow.app
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-stone-200 flex items-center gap-4 text-xs text-stone-400">
          <Link href="/" className="hover:text-stone-600">
            Home
          </Link>
          <Link href="/terms" className="hover:text-stone-600">
            Terms of Service
          </Link>
        </div>
      </div>
    </div>
  )
}
