'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { LeadStatus } from '@togari/core';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'engaged', 'qualified', 'opportunity'];

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  engaged: 'Engaged',
  qualified: 'Qualified',
  opportunity: 'Opportunity',
  customer: 'Customer',
  churned: 'Churned',
  disqualified: 'Disqualified',
};

const ROUTING_TIER_COLORS: Record<string, string> = {
  high_touch: 'bg-green-100 text-green-800',
  standard: 'bg-blue-100 text-blue-800',
  nurture: 'bg-yellow-100 text-yellow-800',
  disqualify: 'bg-gray-100 text-gray-800',
};

export default function SalesPipelinePage() {
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus>('new');

  // Fetch leads by status
  const { data: leads, isLoading } = trpc.people.list.useQuery(
    { status: selectedStatus, limit: 50 },
    { enabled: true }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Sales Pipeline</h1>
        <p className="mt-2 text-gray-600">Manage your leads and opportunities</p>
      </div>

      {/* Status Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={`
                py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                ${
                  selectedStatus === status
                    ? 'border-purple-500 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </nav>
      </div>

      {/* Leads Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading leads...</div>
      ) : leads && leads.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {leads.map((lead) => (
            <Card key={lead.personId} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{lead.fullName}</CardTitle>
                    {lead.currentTitle && (
                      <p className="text-sm text-gray-600 mt-1">{lead.currentTitle}</p>
                    )}
                    {lead.currentCompany && (
                      <p className="text-sm text-gray-500">{lead.currentCompany}</p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Scores */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Score</span>
                    <span className="font-semibold">{lead.compositeScore}/100</span>
                  </div>

                  {/* Routing Tier */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Tier</span>
                    <Badge
                      className={ROUTING_TIER_COLORS[lead.routingTier] || 'bg-gray-100'}
                      variant="outline"
                    >
                      {lead.routingTier.replace('_', ' ')}
                    </Badge>
                  </div>

                  {/* Source */}
                  {lead.sourceChannel && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Source</span>
                      <Badge variant="secondary">{lead.sourceChannel.replace('_', ' ')}</Badge>
                    </div>
                  )}

                  {/* LinkedIn */}
                  {lead.linkedinUrl && (
                    <a
                      href={lead.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-purple-600 hover:text-purple-700"
                    >
                      View LinkedIn →
                    </a>
                  )}

                  {/* Metadata */}
                  <div className="text-xs text-gray-400 pt-2 border-t">
                    Added {new Date(lead.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-gray-500">No leads in {STATUS_LABELS[selectedStatus]} status</p>
            <p className="text-sm text-gray-400 mt-2">
              Leads will appear here as they're added to Togari
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
