import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">A</div>
            <span className="text-xl font-semibold">Apex OS</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
          <p className="text-gray-500">Effective: 1 January 2026 · TechnoEdge Learning Services</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
            <p className="text-gray-600 leading-relaxed">By accessing and using Apex OS, you agree to be bound by these Terms of Service. Apex OS is the internal business operating system of TechnoEdge Learning Services and is intended exclusively for authorised employees and contractors.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">2. Permitted Use</h2>
            <p className="text-gray-600 leading-relaxed">Apex OS is provided for internal business operations only. You may not share your login credentials, access data beyond your role permissions, or use the system for purposes unrelated to your role at TechnoEdge Learning Services.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">3. Employee Responsibilities</h2>
            <p className="text-gray-600 leading-relaxed">You are responsible for maintaining the confidentiality of your account credentials. Report any suspected security issues immediately to admin@technoedgels.com. All actions taken using your account are your responsibility.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">4. Data Handling</h2>
            <p className="text-gray-600 leading-relaxed">All data entered into Apex OS is stored securely on TechnoEdge servers. Access to data is controlled by your assigned role. Ticket history, leave records, and activity logs are retained for operational purposes.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-3">5. Changes to Terms</h2>
            <p className="text-gray-600 leading-relaxed">TechnoEdge Learning Services reserves the right to update these terms. Significant changes will be communicated through Apex OS notifications. Continued use after changes constitutes acceptance.</p>
          </section>
        </div>

        <div className="mt-8 text-center text-sm text-gray-400 flex items-center justify-center gap-4">
          <Link href="/login" className="text-blue-600 hover:underline">← Back to Login</Link>
          <span>·</span>
          <Link href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}
