import React, { useState } from 'react';
import { AlertTriangle, Power, Shield, Building2, Globe, DollarSign } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ConfirmModal } from '../common/Modal';
import { Textarea } from '../common/Input';
import { cn, formatDateTime } from '@/lib/utils';
import type { KillSwitch } from '@/lib/api';

interface KillSwitchPanelProps {
  killSwitches: KillSwitch[];
  onActivate: (id: string, reason: string) => Promise<void>;
  onDeactivate: (id: string) => Promise<void>;
}

export function KillSwitchPanel({
  killSwitches,
  onActivate,
  onDeactivate,
}: KillSwitchPanelProps) {
  const [selectedSwitch, setSelectedSwitch] = useState<KillSwitch | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [action, setAction] = useState<'activate' | 'deactivate'>('activate');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    if (!selectedSwitch) return;
    
    setLoading(true);
    try {
      if (action === 'activate') {
        await onActivate(selectedSwitch.id, reason);
      } else {
        await onDeactivate(selectedSwitch.id);
      }
      setShowConfirm(false);
      setReason('');
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'GLOBAL':
        return <Globe className="h-5 w-5" />;
      case 'PARTICIPANT':
        return <Building2 className="h-5 w-5" />;
      case 'CURRENCY':
        return <DollarSign className="h-5 w-5" />;
      default:
        return <Shield className="h-5 w-5" />;
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
            <CardTitle>Kill Switches</CardTitle>
          </div>
          <Badge variant="warning">
            {killSwitches.filter((killSwitch) => killSwitch.active).length} Active
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {killSwitches.map((killSwitch) => (
              <div
                key={killSwitch.id}
                className={cn(
                  'flex items-center justify-between p-4 rounded-lg border-2',
                  killSwitch.active
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-white'
                )}
              >
                <div className="flex items-center">
                  <div
                    className={cn(
                      'p-2 rounded-lg mr-3',
                      killSwitch.active
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-600'
                    )}
                  >
                    {getIcon(killSwitch.type)}
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">{killSwitch.name}</h4>
                    <p className="text-sm text-gray-500">
                      {killSwitch.type} - {killSwitch.scope || 'All'}
                    </p>
                    {killSwitch.active && killSwitch.activated_at && (
                      <p className="text-xs text-red-600 mt-1">
                        Activated {formatDateTime(killSwitch.activated_at)} by{' '}
                        {killSwitch.activated_by}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge
                    variant={killSwitch.active ? 'danger' : 'success'}
                  >
                    {killSwitch.active ? 'ACTIVE' : 'INACTIVE'}
                  </Badge>
                  <Button
                    variant={killSwitch.active ? 'secondary' : 'danger'}
                    size="sm"
                    onClick={() => {
                      setSelectedSwitch(killSwitch);
                      setAction(
                        killSwitch.active ? 'deactivate' : 'activate'
                      );
                      setShowConfirm(true);
                    }}
                  >
                    <Power className="h-4 w-4 mr-1" />
                    {killSwitch.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => {
          setShowConfirm(false);
          setReason('');
        }}
        onConfirm={handleAction}
        title={
          action === 'activate'
            ? `Activate ${selectedSwitch?.name}?`
            : `Deactivate ${selectedSwitch?.name}?`
        }
        message={
          action === 'activate'
            ? 'This will immediately stop all affected transactions. This action will be logged for audit purposes.'
            : 'This will resume normal transaction processing for affected participants.'
        }
        confirmText={action === 'activate' ? 'Activate Kill Switch' : 'Deactivate'}
        variant={action === 'activate' ? 'danger' : 'primary'}
        loading={loading}
      />
    </>
  );
}

interface EmergencyActionsProps {
  onGlobalHalt: () => void;
  onResumeAll: () => void;
  isGlobalHalted: boolean;
}

export function EmergencyActions({
  onGlobalHalt,
  onResumeAll,
  isGlobalHalted,
}: EmergencyActionsProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [action, setAction] = useState<'halt' | 'resume'>('halt');

  return (
    <>
      <Card className={cn(isGlobalHalted && 'border-red-500 border-2')}>
        <CardHeader>
          <CardTitle className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
            Emergency Controls
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              disabled={isGlobalHalted}
              onClick={() => {
                setAction('halt');
                setShowConfirm(true);
              }}
            >
              <Power className="h-5 w-5 mr-2" />
              Global Halt
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={!isGlobalHalted}
              onClick={() => {
                setAction('resume');
                setShowConfirm(true);
              }}
            >
              <Power className="h-5 w-5 mr-2" />
              Resume All
            </Button>
          </div>
          {isGlobalHalted && (
            <div className="mt-4 p-3 bg-red-100 rounded-lg">
              <p className="text-sm text-red-800 font-medium">
                System is currently in GLOBAL HALT mode. All transactions are
                suspended.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={() => {
          if (action === 'halt') {
            onGlobalHalt();
          } else {
            onResumeAll();
          }
          setShowConfirm(false);
        }}
        title={action === 'halt' ? 'Confirm Global Halt' : 'Confirm Resume All'}
        message={
          action === 'halt'
            ? 'This will IMMEDIATELY STOP ALL TRANSACTIONS across the entire platform. This is an emergency action and should only be used in critical situations.'
            : 'This will resume normal transaction processing across the entire platform.'
        }
        confirmText={action === 'halt' ? 'HALT ALL TRANSACTIONS' : 'Resume All'}
        variant={action === 'halt' ? 'danger' : 'primary'}
      />
    </>
  );
}
