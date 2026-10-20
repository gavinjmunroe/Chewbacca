'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Users, Database, TrendingUp, Heart, Stethoscope } from 'lucide-react';

// Mock data for healthcare demo
const mockStats = {
  totalPatients: 2487,
  activeProviders: 42,
  dataSources: 4,
  syncRate: 98.5,
};

const mockDataSources = [
  { name: 'Exa AI Search', status: 'connected', count: 1240 },
  { name: 'Structify', status: 'connected', count: 856 },
  { name: 'Happenstance', status: 'connected', count: 234 },
  { name: 'Serif Health', status: 'connected', count: 157 },
];

const mockRecentActivity = [
  {
    id: 1,
    type: 'sync',
    message: 'Synced 45 new provider records from Serif Health',
    time: '5 min ago',
  },
  {
    id: 2,
    type: 'enrichment',
    message: 'Enriched 123 patient profiles with Structify',
    time: '12 min ago',
  },
  {
    id: 3,
    type: 'search',
    message: 'Exa AI completed healthcare research query',
    time: '1 hour ago',
  },
  {
    id: 4,
    type: 'analytics',
    message: 'BigQuery analytics pipeline completed',
    time: '2 hours ago',
  },
];

const mockHealthMetrics = [
  { dimension: 'Physical', score: 85, color: 'bg-blue-500' },
  { dimension: 'Emotional', score: 78, color: 'bg-purple-500' },
  { dimension: 'Social', score: 92, color: 'bg-green-500' },
  { dimension: 'Spiritual', score: 73, color: 'bg-yellow-500' },
  { dimension: 'Intellectual', score: 88, color: 'bg-indigo-500' },
  { dimension: 'Financial', score: 81, color: 'bg-pink-500' },
];

export default function DashboardDemoPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Healthcare Data Platform</h1>
        <p className="mt-2 text-gray-600">
          Real-time healthcare data integration and analytics - MAIA Biotech Spring 2026
        </p>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.totalPatients.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              +12% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Providers</CardTitle>
            <Stethoscope className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.activeProviders}</div>
            <p className="text-xs text-muted-foreground">
              +3 new this week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Sources</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.dataSources}</div>
            <p className="text-xs text-muted-foreground">
              All systems operational
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sync Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.syncRate}%</div>
            <p className="text-xs text-muted-foreground">
              Excellent performance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Data Sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Connected Data Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockDataSources.map((source) => (
                <div
                  key={source.name}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <div>
                      <p className="font-medium">{source.name}</p>
                      <p className="text-sm text-gray-500">
                        {source.count.toLocaleString()} records
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    {source.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockRecentActivity.map((activity) => (
                <div key={activity.id} className="flex gap-3">
                  <div className="mt-1">
                    <Activity className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{activity.message}</p>
                    <p className="text-xs text-gray-500">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Health Dimensions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-red-500" />
            Six-Dimensional Health Tracking
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {mockHealthMetrics.map((metric) => (
              <div key={metric.dimension} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">{metric.dimension}</span>
                  <span className="text-sm text-gray-600">{metric.score}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`${metric.color} h-2 rounded-full transition-all`}
                    style={{ width: `${metric.score}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button className="p-4 border rounded-lg hover:bg-gray-50 transition-colors text-left">
              <h3 className="font-semibold text-gray-900">Run Data Sync</h3>
              <p className="text-sm text-gray-600 mt-1">Sync all data sources</p>
            </button>

            <button className="p-4 border rounded-lg hover:bg-gray-50 transition-colors text-left">
              <h3 className="font-semibold text-gray-900">View Analytics</h3>
              <p className="text-sm text-gray-600 mt-1">BigQuery insights</p>
            </button>

            <button className="p-4 border rounded-lg hover:bg-gray-50 transition-colors text-left">
              <h3 className="font-semibold text-gray-900">AI Assistant</h3>
              <p className="text-sm text-gray-600 mt-1">Chat with your data</p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Demo Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="text-blue-600 mt-1">ℹ️</div>
          <div>
            <h4 className="font-semibold text-blue-900">Demo Mode</h4>
            <p className="text-sm text-blue-700 mt-1">
              This dashboard is using mock data. Connect to BigQuery and configure API keys in .env
              to enable live data integration.
            </p>
            <p className="text-sm text-blue-700 mt-2">
              <strong>MAIA Biotech Spring 2026</strong> - Healthcare Data Integration Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
