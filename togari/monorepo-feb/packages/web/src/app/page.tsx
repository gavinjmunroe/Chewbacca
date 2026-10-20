import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Togari
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          AI-native enterprise operating system for health & wellness practitioners
        </p>

        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            🔗 Integrated with Amber
          </h2>
          <p className="text-gray-600 mb-6">
            Togari is powered by Amber ID. All authentication happens through your Amber account.
          </p>

          <div className="space-y-4">
            <Link
              href="/dashboard/demo"
              className="inline-block bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors w-full text-center"
            >
              View Demo Dashboard
            </Link>
            <Link
              href="/dashboard"
              className="inline-block bg-gray-200 text-gray-800 px-8 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors w-full text-center"
            >
              Go to Dashboard (Requires Backend)
            </Link>
          </div>
        </div>

        <div className="text-sm text-gray-500">
          <p className="mb-2">✅ Structify connected</p>
          <p className="mb-2">🔄 Ready for Amber ID integration</p>
          <p>🚀 Development mode active</p>
        </div>
      </div>
    </div>
  );
}
