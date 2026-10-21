'use client'

import * as React from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { APPLICATION_STATUS_LABELS } from '@/lib/utils'

interface FunnelItem {
  status: string
  count: number
}

interface TimelineItem {
  date: string
  count: number
}

interface StageDistItem {
  name: string
  value: number
}

interface Props {
  funnelData: FunnelItem[]
  timelineData: TimelineItem[]
  stageDistData: StageDistItem[]
}

const STATUS_COLORS: Record<string, string> = {
  submitted: '#3b82f6',
  under_review: '#f59e0b',
  advancing: '#8b5cf6',
  accepted: '#10b981',
  waitlisted: '#f97316',
  rejected: '#ef4444',
  withdrawn: '#78716c',
}

const PIE_COLORS = [
  '#1c1917', '#292524', '#44403c', '#57534e', '#78716c',
  '#a8a29e', '#d6d3d1', '#e7e5e4', '#f5f5f4',
]

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value: number; name?: string }[]
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-md text-sm">
        {label && <p className="font-medium text-stone-700 mb-1">{label}</p>}
        {payload.map((p, i) => (
          <p key={i} className="text-stone-600">
            {p.name ? `${p.name}: ` : ''}<strong>{p.value}</strong>
          </p>
        ))}
      </div>
    )
  }
  return null
}

export function AnalyticsCharts({ funnelData, timelineData, stageDistData }: Props) {
  const showFunnel = funnelData.length > 0
  const showTimeline = timelineData.length > 0
  const showDist = stageDistData.some((d) => d.value > 0)

  if (!showFunnel && !showTimeline && !showDist) {
    return (
      <div className="rounded-lg border border-dashed border-stone-200 py-12 text-center text-sm text-stone-400">
        No data to display yet. Applicants will appear here once they apply.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Application Funnel */}
      {showFunnel && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Application Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={funnelData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f4" />
                <XAxis
                  dataKey="status"
                  tick={{ fontSize: 11, fill: '#78716c' }}
                  tickFormatter={(val) => APPLICATION_STATUS_LABELS[val] ?? val}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#78716c' }}
                  allowDecimals={false}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  formatter={(val, _, props) => [
                    val,
                    APPLICATION_STATUS_LABELS[props.payload?.status] ?? props.payload?.status,
                  ]}
                  labelFormatter={() => ''}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {funnelData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={STATUS_COLORS[entry.status] ?? '#a8a29e'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Applications Over Time */}
      {showTimeline && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Applications Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={timelineData}
                margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f4" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#78716c' }}
                  tickFormatter={(val) =>
                    new Date(val + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })
                  }
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#78716c' }}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload?.length) {
                      return (
                        <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-md text-sm">
                          <p className="font-medium text-stone-700 mb-0.5">
                            {new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                          <p className="text-stone-600">
                            <strong>{payload[0].value}</strong> submission
                            {payload[0].value !== 1 ? 's' : ''}
                          </p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#1c1917"
                  strokeWidth={2}
                  dot={{ fill: '#1c1917', r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Stage Distribution */}
      {showDist && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Stage Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={stageDistData.filter((d) => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {stageDistData
                      .filter((d) => d.value > 0)
                      .map((entry, index) => (
                        <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload?.length) {
                        return (
                          <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-md text-sm">
                            <p className="font-medium text-stone-700">{payload[0].name}</p>
                            <p className="text-stone-600">
                              <strong>{payload[0].value}</strong> applicant
                              {payload[0].value !== 1 ? 's' : ''}
                            </p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Legend */}
              <div className="space-y-2 flex-1">
                {stageDistData
                  .filter((d) => d.value > 0)
                  .map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-sm shrink-0"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="text-sm text-stone-700 flex-1 truncate">{entry.name}</span>
                      <span className="text-sm font-medium text-stone-900">{entry.value}</span>
                    </div>
                  ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
