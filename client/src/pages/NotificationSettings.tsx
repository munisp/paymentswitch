import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Bell, Mail, MessageSquare, Shield, Key, Lock } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { createLogger } from '@/lib/logger';
const log = createLogger('NotificationSettings');

export default function NotificationSettings() {
  const { data: preferences, isLoading, refetch } = trpc.notificationPreferences.getPreferences.useQuery();
  const updateMutation = trpc.notificationPreferences.updatePreferences.useMutation();
  const resetMutation = trpc.notificationPreferences.resetPreferences.useMutation();

  const [localPrefs, setLocalPrefs] = useState({
    emailNotifications: true,
    smsNotifications: false,
    newDeviceAlerts: true,
    suspiciousActivityAlerts: true,
    loginAlerts: false,
    passwordChangeAlerts: true,
    twoFactorChangeAlerts: true,
  });

  const [hasChanges, setHasChanges] = useState(false);

  // Update local state when preferences are loaded
  useEffect(() => {
    if (preferences) {
      setLocalPrefs(preferences);
      setHasChanges(false);
    }
  }, [preferences]);

  const handleToggle = (key: keyof typeof localPrefs) => {
    setLocalPrefs(prev => ({ ...prev, [key]: !prev[key] }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      const result = await updateMutation.mutateAsync(localPrefs);
      
      if (result.success) {
        toast.success('Preferences saved successfully');
        setHasChanges(false);
        refetch();
      } else {
        toast.error(result.error || 'Failed to save preferences');
      }
    } catch (error) {
      toast.error('Failed to save preferences');
      log.error(String(error));
    }
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to reset all notification preferences to defaults?')) {
      return;
    }

    try {
      const result = await resetMutation.mutateAsync();
      
      if (result.success) {
        toast.success('Preferences reset to defaults');
        setHasChanges(false);
        refetch();
      } else {
        toast.error(result.error || 'Failed to reset preferences');
      }
    } catch (error) {
      toast.error('Failed to reset preferences');
      log.error(String(error));
    }
  };

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Notification Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage how you receive security alerts and notifications
        </p>
      </div>

      <div className="space-y-6">
        {/* Notification Channels */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification Channels
            </CardTitle>
            <CardDescription>
              Choose how you want to receive notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="email-notifications" className="font-medium">Email Notifications</Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  Receive security alerts via email
                </p>
              </div>
              <Switch
                id="email-notifications"
                checked={localPrefs.emailNotifications}
                onCheckedChange={() => handleToggle('emailNotifications')}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="sms-notifications" className="font-medium">SMS Notifications</Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  Receive security alerts via text message
                </p>
              </div>
              <Switch
                id="sms-notifications"
                checked={localPrefs.smsNotifications}
                onCheckedChange={() => handleToggle('smsNotifications')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Security Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security Alerts
            </CardTitle>
            <CardDescription>
              Configure which security events trigger notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="new-device-alerts" className="font-medium">New Device Login</Label>
                <p className="text-sm text-muted-foreground">
                  Alert when you log in from a new device
                </p>
              </div>
              <Switch
                id="new-device-alerts"
                checked={localPrefs.newDeviceAlerts}
                onCheckedChange={() => handleToggle('newDeviceAlerts')}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="suspicious-activity-alerts" className="font-medium">Suspicious Activity</Label>
                <p className="text-sm text-muted-foreground">
                  Alert when suspicious login patterns are detected
                </p>
              </div>
              <Switch
                id="suspicious-activity-alerts"
                checked={localPrefs.suspiciousActivityAlerts}
                onCheckedChange={() => handleToggle('suspiciousActivityAlerts')}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="login-alerts" className="font-medium">All Logins</Label>
                <p className="text-sm text-muted-foreground">
                  Alert on every successful login (not recommended)
                </p>
              </div>
              <Switch
                id="login-alerts"
                checked={localPrefs.loginAlerts}
                onCheckedChange={() => handleToggle('loginAlerts')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Account Changes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Account Changes
            </CardTitle>
            <CardDescription>
              Get notified when important account settings change
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="password-change-alerts" className="font-medium">Password Changes</Label>
                <p className="text-sm text-muted-foreground">
                  Alert when your password is changed
                </p>
              </div>
              <Switch
                id="password-change-alerts"
                checked={localPrefs.passwordChangeAlerts}
                onCheckedChange={() => handleToggle('passwordChangeAlerts')}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="two-factor-change-alerts" className="font-medium">Two-Factor Authentication</Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  Alert when 2FA is enabled, disabled, or reset
                </p>
              </div>
              <Switch
                id="two-factor-change-alerts"
                checked={localPrefs.twoFactorChangeAlerts}
                onCheckedChange={() => handleToggle('twoFactorChangeAlerts')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={resetMutation.isPending}
          >
            {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset to Defaults
          </Button>
          
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
