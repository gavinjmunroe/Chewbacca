import Link from 'next/link'

export const metadata = { title: 'Terms of Service — Marrow' }

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-8">
          <Link href="/" className="text-sm text-stone-400 hover:text-stone-600">
            Marrow
          </Link>
          <h1 className="mt-4 text-3xl font-bold text-stone-900">Terms of Service</h1>
          <p className="mt-2 text-sm text-stone-500">Last updated: March 2026</p>
        </div>

        <div className="prose prose-stone max-w-none text-stone-700 space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Marrow ("the Service"), you agree to be bound by these Terms of
              Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">2. Use of the Service</h2>
            <p>
              Marrow provides a platform for student organizations to manage recruiting cycles and
              for applicants to submit applications. You agree to use the Service only for lawful
              purposes and in accordance with these Terms.
            </p>
            <p className="mt-2">You agree not to:</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Use the Service to harass, abuse, or harm others</li>
              <li>Misrepresent your identity or affiliation</li>
              <li>Upload malicious code or attempt to compromise the Service</li>
              <li>Scrape or harvest data without permission</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">3. Accounts</h2>
            <p>
              You are responsible for maintaining the security of your account and for all activity
              that occurs under your account. Notify us immediately of any unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">4. User Content</h2>
            <p>
              You retain ownership of content you submit through the Service. By submitting content,
              you grant Marrow a limited license to store and display that content solely for the
              purpose of operating the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">5. Termination</h2>
            <p>
              We reserve the right to suspend or terminate accounts that violate these Terms or for
              any other reason at our discretion with reasonable notice.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">
              6. Disclaimer of Warranties
            </h2>
            <p>
              The Service is provided "as is" without warranties of any kind. We do not guarantee
              that the Service will be uninterrupted, error-free, or free of security vulnerabilities.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">
              7. Limitation of Liability
            </h2>
            <p>
              To the fullest extent permitted by law, Marrow shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages arising out of your use of the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">8. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. Continued use of the Service after changes
              constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">9. Contact</h2>
            <p>
              Questions about these Terms? Contact us at{' '}
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
          <Link href="/privacy" className="hover:text-stone-600">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  )
}
