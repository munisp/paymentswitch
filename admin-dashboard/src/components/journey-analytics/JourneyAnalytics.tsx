'use client';

import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback } from 'react';

interface JourneyMetric {
  journeyId: number;
  journeyName: string;
  totalRuns: number;
  successRate: number;
  avgDuration: string;
  lastRun: string;
  trend: 'up' | 'down' | 'stable';
}

interface DailyMetric {
  date: string;
  runs: number;
  success: number;
  failed: number;
}

const defaultMetrics: JourneyMetric[] = [
  { journeyId: 1, journeyName: 'Admin Provision Organization', totalRuns: 1250, successRate: 98.5, avgDuration: '2.3s', lastRun: '5 min ago', trend: 'up' },
  { journeyId: 2, journeyName: 'Participant KYB Activation', totalRuns: 890, successRate: 94.2, avgDuration: '45s', lastRun: '12 min ago', trend: 'stable' },
  { journeyId: 3, journeyName: 'User KYC Product Access', totalRuns: 3420, successRate: 96.8, avgDuration: '30s', lastRun: '2 min ago', trend: 'up' },
  { journeyId: 4, journeyName: 'Merchant POS Onboarding', totalRuns: 567, successRate: 92.1, avgDuration: '1m 15s', lastRun: '25 min ago', trend: 'down' },
  { journeyId: 5, journeyName: 'Developer Sandbox Access', totalRuns: 2100, successRate: 99.1, avgDuration: '5s', lastRun: '1 min ago', trend: 'up' },
  { journeyId: 6, journeyName: 'P2P Transfer Mojaloop', totalRuns: 45000, successRate: 99.7, avgDuration: '1.2s', lastRun: '10 sec ago', trend: 'up' },
  { journeyId: 7, journeyName: 'QR Code Payment', totalRuns: 28000, successRate: 98.9, avgDuration: '0.8s', lastRun: '5 sec ago', trend: 'stable' },
  { journeyId: 8, journeyName: 'Remittance FX Transfer', totalRuns: 5600, successRate: 97.3, avgDuration: '3.5s', lastRun: '3 min ago', trend: 'up' },
];

const defaultDailyData: DailyMetric[] = [
  { date: 'Mon', runs: 12500, success: 12300, failed: 200 },
  { date: 'Tue', runs: 13200, success: 13000, failed: 200 },
  { date: 'Wed', runs: 11800, success: 11600, failed: 200 },
  { date: 'Thu', runs: 14500, success: 14200, failed: 300 },
  { date: 'Fri', runs: 15200, success: 15000, failed: 200 },
  { date: 'Sat', runs: 8900, success: 8800, failed: 100 },
  { date: 'Sun', runs: 7600, success: 7500, failed: 100 },
];

export default function JourneyAnalytics() {
  const [apiMetrics, setApiMetrics] = useState<JourneyMetric[] | null>(null);
  useEffect(() => {
    fetch('http://localhost:8080/api/v1/journeys/analytics')
      .then(r => r.json()).then(d => setApiMetrics(d.metrics))
      .catch((err: unknown) => { logger.error("API fallback:", err); setApiMetrics(defaultMetrics); });
  }, []);
  const metrics = apiMetrics || defaultMetrics;
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const totalRuns = metrics.reduce((sum, m) => sum + m.totalRuns, 0);
  const avgSuccessRate = metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Journey Analytics
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Monitor performance across all user journeys
        </p>
      </div>

      {/* Time Range Selector */}
      <div className="mb-6 flex gap-2">
        {(['24h', '7d', '30d'] as const).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              timeRange === range
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600'
            }`}
          >
            {range === '24h' ? 'Last 24 Hours' : range === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Runs</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {totalRuns.toLocaleString()}
          </p>
          <p className="text-xs text-green-600 mt-1">+12.5% from last period</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Success Rate</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {avgSuccessRate.toFixed(1)}%
          </p>
          <p className="text-xs text-green-600 mt-1">+0.3% from last period</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Active Journeys</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">20</p>
          <p className="text-xs text-gray-500 mt-1">All operational</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Duration</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">1.8s</p>
          <p className="text-xs text-green-600 mt-1">-0.2s from last period</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 md:p-6 shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Journey Runs Over Time
        </h2>
        <div className="h-64 flex items-end gap-2 md:gap-4">
          {defaultDailyData.map((day, index) => {
            const maxRuns = Math.max(...defaultDailyData.map(d => d.runs));
            const successHeight = (day.success / maxRuns) * 100;
            const failedHeight = (day.failed / maxRuns) * 100;
            
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col-reverse" style={{ height: '200px' }}>
                  <div
                    className="w-full bg-green-500 rounded-t"
                    style={{ height: `${successHeight}%` }}
                  />
                  <div
                    className="w-full bg-red-500"
                    style={{ height: `${failedHeight}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{day.date}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Success</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Failed</span>
          </div>
        </div>
      </div>

      {/* Journey Performance Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Journey Performance
          </h2>
        </div>
        
        {/* Mobile View */}
        {isMobile ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {metrics.map((metric) => (
              <div key={metric.journeyId} className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {metric.journeyName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Journey {metric.journeyId}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    metric.trend === 'up' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                    metric.trend === 'down' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                    'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                  }`}>
                    {metric.trend === 'up' ? 'Trending Up' : metric.trend === 'down' ? 'Trending Down' : 'Stable'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Runs:</span>
                    <span className="ml-1 text-gray-900 dark:text-white">{metric.totalRuns.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Success:</span>
                    <span className="ml-1 text-gray-900 dark:text-white">{metric.successRate}%</span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Avg Time:</span>
                    <span className="ml-1 text-gray-900 dark:text-white">{metric.avgDuration}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Last Run:</span>
                    <span className="ml-1 text-gray-900 dark:text-white">{metric.lastRun}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Desktop View */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-750">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Journey
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Total Runs
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Success Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Avg Duration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Last Run
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {metrics.map((metric) => (
                  <tr key={metric.journeyId} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {metric.journeyName}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Journey {metric.journeyId}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white">
                      {metric.totalRuns.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              metric.successRate >= 98 ? 'bg-green-500' :
                              metric.successRate >= 95 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${metric.successRate}%` }}
                          />
                        </div>
                        <span className="text-gray-900 dark:text-white">{metric.successRate}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white">
                      {metric.avgDuration}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-gray-400">
                      {metric.lastRun}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        metric.trend === 'up' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                        metric.trend === 'down' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                      }`}>
                        {metric.trend === 'up' && (
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                        {metric.trend === 'down' && (
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                        {metric.trend === 'up' ? 'Up' : metric.trend === 'down' ? 'Down' : 'Stable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
