import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Smartphone, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

/**
 * Trusted Devices Management Page
 * 
 * Allows users to view and manage devices trusted for 2FA bypass
 */

export default function TrustedDevices() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);

  const utils = trpc.useUtils();

  // Fetch trusted devices
  const { data, isLoading, error } = trpc.trustedDevice.listDevices.useQuery();

  // Revoke single device
  const revokeMutation = trpc.trustedDevice.revokeDevice.useMutation({
    onSuccess: () => {
      toast.success('Device trust revoked');
      utils.trustedDevice.listDevices.invalidate();
      setShowRevokeDialog(false);
      setSelectedDeviceId(null);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to revoke device');
    },
  });

  // Revoke all devices
  const revokeAllMutation = trpc.trustedDevice.revokeAllDevices.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.trustedDevice.listDevices.invalidate();
      setShowRevokeAllDialog(false);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to revoke devices');
    },
  });

  const handleRevokeDevice = (deviceId: number) => {
    setSelectedDeviceId(deviceId);
    setShowRevokeDialog(true);
  };

  const confirmRevoke = () => {
    if (selectedDeviceId) {
      revokeMutation.mutate({ deviceId: selectedDeviceId });
    }
  };

  const confirmRevokeAll = () => {
    revokeAllMutation.mutate();
  };

  const getDeviceIcon = (deviceName: string | null) => {
    if (!deviceName) return <Smartphone className="h-5 w-5" />;
    
    const name = deviceName.toLowerCase();
    if (name.includes('iphone') || name.includes('ipad') || name.includes('mac')) {
      return <Smartphone className="h-5 w-5 text-gray-600" />;
    }
    if (name.includes('android')) {
      return <Smartphone className="h-5 w-5 text-green-600" />;
    }
    if (name.includes('windows') || name.includes('linux')) {
      return <Smartphone className="h-5 w-5 text-blue-600" />;
    }
    return <Smartphone className="h-5 w-5" />;
  };

  const isExpiringSoon = (expiresAt: Date) => {
    const daysUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry < 7;
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Trusted Devices</h1>
          <p className="text-muted-foreground">
            Manage devices that can skip two-factor authentication for 30 days
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your Trusted Devices</CardTitle>
                <CardDescription>
                  Devices you've marked as trusted will not require 2FA verification for 30 days
                </CardDescription>
              </div>
              {data && data.devices.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowRevokeAllDialog(true)}
                  disabled={revokeAllMutation.isPending}
                >
                  {revokeAllMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Trash2 className="mr-2 h-4 w-4" />
                  Revoke All
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {error && (
              <div className="flex items-center justify-center py-12 text-destructive">
                <AlertTriangle className="h-5 w-5 mr-2" />
                <span>Failed to load trusted devices</span>
              </div>
            )}

            {data && data.devices.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Smartphone className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">No Trusted Devices</p>
                <p className="text-sm text-center max-w-md">
                  When you verify 2FA, check "Remember this device for 30 days" to add it to this list.
                  Trusted devices won't require 2FA verification for 30 days.
                </p>
              </div>
            )}

            {data && data.devices.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Device</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Trusted Since</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.devices.map((device) => (
                      <TableRow key={device.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {getDeviceIcon(device.deviceName)}
                            <div>
                              <div className="font-medium">{device.deviceName || 'Unknown Device'}</div>
                              {device.ipAddress && (
                                <div className="text-xs text-muted-foreground font-mono">
                                  {device.ipAddress}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(device.lastUsedAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(device.trustedAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2">
                            {device.expiresAt && isExpiringSoon(device.expiresAt) && (
                              <AlertTriangle className="h-4 w-4 text-orange-500" />
                            )}
                            <span className={device.expiresAt && isExpiringSoon(device.expiresAt) ? 'text-orange-600 font-medium' : 'text-muted-foreground'}>
                              {device.expiresAt ? formatDistanceToNow(new Date(device.expiresAt), { addSuffix: true }) : 'N/A'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {device.isActive ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                              Revoked
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {device.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleRevokeDevice(device.id)}
                              disabled={revokeMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {data && data.devices.length > 0 && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex gap-2">
                  <AlertTriangle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-900">
                    <p className="font-medium mb-1">Security Tip</p>
                    <p>
                      Only trust devices you own and use regularly. If you suspect unauthorized access,
                      revoke all trusted devices immediately and change your password.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revoke Single Device Dialog */}
        <Dialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revoke Device Trust?</DialogTitle>
              <DialogDescription>
                This device will require 2FA verification on the next login. You can trust it again later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRevokeDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmRevoke}
                disabled={revokeMutation.isPending}
              >
                {revokeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Revoke Device
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revoke All Devices Dialog */}
        <Dialog open={showRevokeAllDialog} onOpenChange={setShowRevokeAllDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revoke All Trusted Devices?</DialogTitle>
              <DialogDescription>
                All devices will require 2FA verification on the next login. This action cannot be undone,
                but you can trust devices again later.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-orange-900">
                  <p className="font-medium mb-1">Warning</p>
                  <p>
                    This will revoke trust for {data?.devices.filter(d => d.isActive).length || 0} active device(s).
                    Use this if you suspect unauthorized access to your account.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRevokeAllDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmRevokeAll}
                disabled={revokeAllMutation.isPending}
              >
                {revokeAllMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Revoke All Devices
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
