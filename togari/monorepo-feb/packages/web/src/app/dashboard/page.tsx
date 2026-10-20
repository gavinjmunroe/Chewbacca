'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';

export default function DashboardPage() {

  // Example: Fetch people count by status
  const { data: newLeads } = trpc.people.list.useQuery(
    { status: 'new', limit: 100 },
    { enabled: true }
  );

  const { data: contactedLeads } = trpc.people.list.useQuery(
    { status: 'contacted', limit: 100 },
    { enabled: true }
  );

  const { data: qualifiedLeads } = trpc.people.list.useQuery(
    { status: 'qualified', limit: 100 },
    { enabled: true }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Welcome to Togari - Your enterprise operating system
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600">New Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{newLeads?.length || 0}</div>
            <p className="text-xs text-gray-500 mt-1">Awaiting first contact</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{contactedLeads?.length || 0}</div>
            <p className="text-xs text-gray-500 mt-1">Currently engaging</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600">Qualified</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{qualifiedLeads?.length || 0}</div>
            <p className="text-xs text-gray-500 mt-1">Ready for conversion</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <a
              href="/dashboard/sales"
              className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              <h3 className="font-semibold text-gray-900">View Pipeline</h3>
              <p className="text-sm text-gray-600 mt-1">Manage your sales pipeline</p>
            </a>

            <a
              href="/dashboard/ai"
              className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              <h3 className="font-semibold text-gray-900">AI Prompt Runner</h3>
              <p className="text-sm text-gray-600 mt-1">Run AI prompts on your data</p>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
