import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Badge, StatusDot } from '../common/Badge';
import { cn } from '@/lib/utils';
import type { ParticipantHealth as ParticipantHealthType } from '@/lib/api';

interface ParticipantHealthGridProps {
  participants: ParticipantHealthType[];
  onParticipantClick?: (participantId: string) => void;
}

type DisplayHealth = 'healthy' | 'degraded' | 'down';

function getHealthStatus(participant: ParticipantHealthType): DisplayHealth {
  // This is a presentation mapping of the persisted lifecycle state, not a
  // separate computed health score. Unrecognized states are displayed as down.
  switch (participant.status.toLowerCase()) {
    case 'active':
      return 'healthy';
    case 'pending':
      return 'degraded';
    default:
      return 'down';
  }
}

export function ParticipantHealthGrid({
  participants,
  onParticipantClick,
}: ParticipantHealthGridProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Participant Health</CardTitle>
        <div className="flex items-center space-x-4 text-sm">
          <div className="flex items-center">
            <StatusDot status="healthy" className="mr-2" />
            <span className="text-gray-600">Active</span>
          </div>
          <div className="flex items-center">
            <StatusDot status="degraded" className="mr-2" />
            <span className="text-gray-600">Pending</span>
          </div>
          <div className="flex items-center">
            <StatusDot status="down" className="mr-2" />
            <span className="text-gray-600">Other state</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {participants.map((participant) => (
            <ParticipantHealthCard
              key={participant.id}
              participant={participant}
              status={getHealthStatus(participant)}
              onClick={() => onParticipantClick?.(participant.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface ParticipantHealthCardProps {
  participant: ParticipantHealthType;
  status: DisplayHealth;
  onClick?: () => void;
}

function ParticipantHealthCard({
  participant,
  status,
  onClick,
}: ParticipantHealthCardProps) {
  const statusColors = {
    healthy: 'border-green-200 bg-green-50',
    degraded: 'border-yellow-200 bg-yellow-50',
    down: 'border-red-200 bg-red-50',
  };

  return (
    <div
      className={cn(
        'rounded-lg border-2 p-3 cursor-pointer transition-all hover:shadow-md',
        statusColors[status]
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-gray-900 text-sm truncate">{participant.name}</span>
        <StatusDot status={status} />
      </div>
      <div className="space-y-1 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>TPS:</span>
          <span className="font-medium">{participant.tps.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span>Success:</span>
          <span className="font-medium">{participant.success_rate.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span>Latency:</span>
          <span className="font-medium">{participant.latency_ms}ms</span>
        </div>
      </div>
    </div>
  );
}

interface ParticipantHealthTableProps {
  participants: ParticipantHealthType[];
  onParticipantClick?: (participantId: string) => void;
}

export function ParticipantHealthTable({
  participants,
  onParticipantClick,
}: ParticipantHealthTableProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Participant Status</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Participant</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Persisted state</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TPS</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Success rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Average latency</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {participants.map((participant) => {
                const healthStatus = getHealthStatus(participant);
                return (
                  <tr
                    key={participant.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onParticipantClick?.(participant.id)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <StatusDot status={healthStatus} className="mr-3" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{participant.name}</div>
                          <div className="text-sm text-gray-500">{participant.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap"><Badge status={participant.status}>{participant.status}</Badge></td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{participant.tps.toFixed(1)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{participant.success_rate.toFixed(1)}%</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{participant.latency_ms}ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
