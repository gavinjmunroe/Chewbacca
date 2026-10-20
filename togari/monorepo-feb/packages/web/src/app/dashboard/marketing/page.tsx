'use client';

import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function MarketingPage() {

  const { data: campaigns, isLoading } = trpc.campaigns.list.useQuery(
    { limit: 50 },
    { enabled: true }
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Marketing Campaigns</h1>
          <p className="mt-2 text-gray-600">Manage your marketing campaigns and sequences</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading campaigns...</div>
      ) : campaigns && campaigns.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <Card key={campaign.campaignId}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{campaign.name}</CardTitle>
                  <Badge
                    variant={campaign.status === 'active' ? 'default' : 'secondary'}
                  >
                    {campaign.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {campaign.description && (
                    <p className="text-sm text-gray-600">{campaign.description}</p>
                  )}

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                    <div>
                      <p className="text-xs text-gray-500">Total Leads</p>
                      <p className="text-lg font-semibold">{campaign.totalLeads}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Sent</p>
                      <p className="text-lg font-semibold">{campaign.emailsSent}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Opened</p>
                      <p className="text-lg font-semibold">{campaign.emailsOpened}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Replied</p>
                      <p className="text-lg font-semibold">{campaign.emailsReplied}</p>
                    </div>
                  </div>

                  {campaign.vertical && (
                    <div className="pt-3 border-t">
                      <Badge variant="outline">{campaign.vertical}</Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-gray-500">No campaigns yet</p>
            <p className="text-sm text-gray-400 mt-2">
              Create your first campaign to start engaging with leads
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
