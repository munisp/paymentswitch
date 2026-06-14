import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Monitor, MapPin, Clock, Shield, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDistanceToNow } from 'date-fns';
import { createLogger } from '@/lib/logger';
const log = createLogger('AccountActivity');

export default function AccountActivity() {
  const { data: loginHistory, isLoading, refetch } = trpc.accountActivity.getLoginHistory.useQuery({ limit: 50 });
  const { data: activeSessions, refetch: refetchSessions } = trpc.accountActivity.getActiveSessions.useQuery();
  const endSessionMutation = trpc.accountActivity.endSession.useMutation();
  const endAllSessionsMutation = trpc.accountActivity.endAllSessions.useMutation();

  const [sessionToEnd, setSessionToEnd] = useState<string | null>(null);
  const [showEndAllDialog, setShowEndAllDialog] = useState(false);

  const handleEndSession = async (sessionId: string | null) => {
    if (!sessionId) return;
    try {
      const result = await endSessionMutation.mutateAsync({ sessionId });
      
      if (result.success) {
        toast.success('Session ended successfully');
        refetch();
        refetchSessions();
      } else {
        toast.error(result.error || 'Failed to end session');
      }
    } catch (error) {
      toast.error('Failed to end session');
      log.error(String(error));
    } finally {
      setSessionToEnd(null);
    }
  };

  const handleEndAllSessions = async () => {
    try {
      const result = await endAllSessionsMutation.mutateAsync();
      
      if (result.success) {
        toast.success(`Ended ${result.count || 0} sessions`);
        refetch();
        refetchSessions();
      } else {
        toast.error(result.error || 'Failed to end sessions');
      }
    } catch (error) {
      toast.error('Failed to end sessions');
      log.error(String(error));
    } finally {
      setShowEndAllDialog(false);
    }
  };

  const getDeviceName = (userAgent: string | null) => {
    if (!userAgent) return 'Unknown Device';
    if (userAgent.includes('Mobile')) return 'Mobile Device';
    if (userAgent.includes('Tablet')) return 'Tablet';
    return 'Desktop';
  };

  const getBrowserName = (userAgent: string | null) => {
    if (!userAgent) return 'Unknown Browser';
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown Browser';
  };

  if (isLoading) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Account Activity</h1>
        <p className="text-muted-foreground mt-2">
          Monitor your login history and manage active sessions
        </p>
      </div>

      <div className="space-y-6">
        {/* Active Sessions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Active Sessions
                </CardTitle>
                <CardDescription>
                  Devices currently signed into your account
                </CardDescription>
              </div>
              {activeSessions && activeSessions.length > 1 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowEndAllDialog(true)}
                  disabled={endAllSessionsMutation.isPending}
                >
                  {endAllSessionsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  End All Sessions
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!activeSessions || activeSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active sessions</p>
            ) : (
              <div className="space-y-4">
                {activeSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-start justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {session.deviceName || getDeviceName(session.userAgent)} • {getBrowserName(session.userAgent)}
                        </span>
                        {session.isTrustedDevice && (
                          <Badge variant="secondary" className="text-xs">
                            Trusted
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {session.city && session.country ? `${session.city}, ${session.country}` : 'Unknown location'}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(session.loginAt), { addSuffix: true })}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        IP: {session.ipAddress}
                      </p>
                    </div>
                    {session.sessionId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => session.sessionId && setSessionToEnd(session.sessionId)}
                        disabled={endSessionMutation.isPending}
                      >
                        End Session
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Login History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Login History
            </CardTitle>
            <CardDescription>
              Recent login attempts and their status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!loginHistory || loginHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No login history</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loginHistory.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {record.success ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className="text-sm">
                              {record.success ? 'Success' : 'Failed'}
                            </span>
                            {record.isSuspicious && (
                              <AlertTriangle className="h-4 w-4 text-yellow-500" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="text-sm font-medium">
                              {record.deviceName || getDeviceName(record.userAgent)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {getBrowserName(record.userAgent)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {record.city && record.country
                              ? `${record.city}, ${record.country}`
                              : 'Unknown'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs">{record.ipAddress}</code>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {formatDistanceToNow(new Date(record.loginAt), { addSuffix: true })}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* End Session Confirmation Dialog */}
      <AlertDialog open={!!sessionToEnd} onOpenChange={() => setSessionToEnd(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will sign you out from this device. You'll need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleEndSession(sessionToEnd)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* End All Sessions Confirmation Dialog */}
      <AlertDialog open={showEndAllDialog} onOpenChange={setShowEndAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End All Sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              This will sign you out from all devices except this one. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEndAllSessions}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End All Sessions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
