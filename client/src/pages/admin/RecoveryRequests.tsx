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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

/**
 * Admin Recovery Requests Dashboard
 * 
 * Allows admins to review and approve/reject 2FA account recovery requests
 */

interface RecoveryRequest {
  id: number;
  userId: number;
  recoveryMethod: string;
  status: string;
  requestedAt?: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
  [key: string]: any;
}

export default function RecoveryRequests() {
  const [selectedRequest, setSelectedRequest] = useState<RecoveryRequest | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
  const [notes, setNotes] = useState('');

  const utils = trpc.useUtils();

  // Fetch pending requests
  const { data, isLoading, error } = trpc.accountRecovery.listPendingRequests.useQuery(undefined, {
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Approve mutation
  const approveMutation = trpc.accountRecovery.approveRecovery.useMutation({
    onSuccess: () => {
      toast.success('Recovery request approved');
      utils.accountRecovery.listPendingRequests.invalidate();
      handleCloseDialog();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to approve request');
    },
  });

  // Reject mutation
  const rejectMutation = trpc.accountRecovery.rejectRecovery.useMutation({
    onSuccess: () => {
      toast.success('Recovery request rejected');
      utils.accountRecovery.listPendingRequests.invalidate();
      handleCloseDialog();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to reject request');
    },
  });

  const handleOpenDialog = (request: RecoveryRequest, action: 'approve' | 'reject') => {
    setSelectedRequest(request);
    setActionType(action);
    setNotes('');
  };

  const handleCloseDialog = () => {
    setSelectedRequest(null);
    setActionType(null);
    setNotes('');
  };

  const handleSubmitAction = () => {
    if (!selectedRequest || !actionType) return;

    if (actionType === 'approve') {
      approveMutation.mutate({
        requestId: selectedRequest.id,
        notes: notes.trim() || undefined,
      });
    } else {
      rejectMutation.mutate({
        requestId: selectedRequest.id,
        notes: notes.trim() || undefined,
      });
    }
  };

  const getStatusBadge = (status: RecoveryRequest['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'approved':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case 'completed':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'expired':
        return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200"><AlertCircle className="h-3 w-3 mr-1" />Expired</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>2FA Recovery Requests</CardTitle>
            <CardDescription>
              Review and manage user account recovery requests
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {error && (
              <div className="flex items-center justify-center py-12 text-destructive">
                <AlertCircle className="h-5 w-5 mr-2" />
                <span>Failed to load recovery requests</span>
              </div>
            )}

            {data && data.requests.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No pending requests</p>
                <p className="text-sm">All recovery requests have been processed</p>
              </div>
            )}

            {data && data.requests.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request ID</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="font-mono text-sm">#{request.id}</TableCell>
                        <TableCell className="font-mono text-sm">{request.userId}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{request.recoveryMethod}</Badge>
                        </TableCell>
                        <TableCell>{getStatusBadge(request.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(request.requestedAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(request.expiresAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {request.ipAddress || 'N/A'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => handleOpenDialog(request, 'approve')}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleOpenDialog(request, 'reject')}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
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

      {/* Action Dialog */}
      <Dialog open={!!selectedRequest && !!actionType} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === 'approve' ? 'Approve' : 'Reject'} Recovery Request
            </DialogTitle>
            <DialogDescription>
              {actionType === 'approve'
                ? 'This will allow the user to reset their 2FA and regain access to their account.'
                : 'This will deny the recovery request. The user will need to submit a new request or contact support.'}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Request ID:</span>
                  <span className="font-mono">#{selectedRequest.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User ID:</span>
                  <span className="font-mono">{selectedRequest.userId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Method:</span>
                  <Badge variant="secondary">{selectedRequest.recoveryMethod}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requested:</span>
                  <span>{formatDistanceToNow(new Date(selectedRequest.requestedAt ?? selectedRequest.createdAt ?? new Date()), { addSuffix: true })}</span>
                </div>
                {selectedRequest.ipAddress && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IP Address:</span>
                    <span className="font-mono text-xs">{selectedRequest.ipAddress}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes about this decision..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitAction}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              variant={actionType === 'approve' ? 'default' : 'destructive'}
            >
              {(approveMutation.isPending || rejectMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {actionType === 'approve' ? 'Approve Request' : 'Reject Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
