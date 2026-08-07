import Link from 'next/link';

export default function PrivacyScreen() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">A</div>
            <span className="text-xl font-semibold">Apex OS</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-gray-500">Effective: 1 January 2026 · TechnoEdge Learning Services</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. What We Collect</h2>
            <p className="text-gray-600 leading-relaxed">Apex OS collects your name, work email, tickets you create and are assigned to, leave requests, and activity logs. This information is provided by you or generated through your use of the platform.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">2. How We Use It</h2>
            <p className="text-gray-600 leading-relaxed">Your data is used for operations management, performance tracking, reporting, and communication within TechnoEdge. We do not sell or share your data with third parties outside the organisation.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">3. Who Can See It</h2>
            <p className="text-gray-600 leading-relaxed">Access is role-based: you can see your own data, your manager can see their team's data, and administrators can see company-wide data. All access is logged for audit purposes.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">4. Data Security</h2>
            <p className="text-gray-600 leading-relaxed">Apex OS uses JWT authentication, bcrypt password hashing, HTTPS encryption in transit, and role-based access controls. Sensitive credentials are never stored in plain text.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">5. Your Rights</h2>
            <p className="text-gray-600 leading-relaxed">You may request corrections to your personal data by contacting admin@technoedgels.com. When you leave TechnoEdge, your account is deactivated and data is retained for compliance purposes.</p>
          </section>
        </div>

        <div className="mt-8 text-center text-sm text-gray-400 flex items-center justify-center gap-4">
          <Link href="/login" className="text-blue-600 hover:underline">← Back to Login</Link>
          <span>·</span>
          <Link href="/terms" className="text-blue-600 hover:underline">Terms of Service</Link>
        </div>
      </div>
    </div>
  );
}
