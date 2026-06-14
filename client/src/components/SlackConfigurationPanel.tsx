import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Send } from 'lucide-react';

interface SlackConfigurationPanelProps {
  credentialId: number;
}

export function SlackConfigurationPanel({ credentialId }: SlackConfigurationPanelProps) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [channelName, setChannelName] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);

  // Queries
  const { data: slackConfig, isLoading, refetch } = trpc.productionGoLive.getSlackConfiguration.useQuery(
    { credentialId },
    { enabled: credentialId > 0 }
  );

  // Mutations
  const configureWebhook = trpc.productionGoLive.configureSlackWebhook.useMutation({
    onSuccess: () => {
      toast.success('Slack webhook configured successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to configure Slack: ${error.message}`);
    },
  });

  const testWebhook = trpc.productionGoLive.testSlackWebhook.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Test message sent to Slack successfully!');
      } else {
        toast.error(`Failed to send test message: ${result.error}`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to test webhook: ${error.message}`);
    },
  });

  const enableNotifications = trpc.productionGoLive.enableSlackNotifications.useMutation({
    onSuccess: () => {
      toast.success('Slack notifications enabled');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to enable notifications: ${error.message}`);
    },
  });

  const disableNotifications = trpc.productionGoLive.disableSlackNotifications.useMutation({
    onSuccess: () => {
      toast.success('Slack notifications disabled');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to disable notifications: ${error.message}`);
    },
  });

  // Initialize form with existing config
  useEffect(() => {
    if (slackConfig) {
      setWebhookUrl(slackConfig.webhookUrl ?? '');
      setChannelName(slackConfig.channelName ?? '');
      setIsEnabled(slackConfig.isActive);
    }
  }, [slackConfig]);

  const handleSave = () => {
    if (!webhookUrl || !channelName) {
      toast.error('Please fill in all fields');
      return;
    }

    configureWebhook.mutate({
      credentialId,
      webhookUrl,
      channelName,
    });
  };

  const handleTest = () => {
    if (!webhookUrl) {
      toast.error('Please enter a webhook URL first');
      return;
    }

    testWebhook.mutate({ webhookUrl });
  };

  const handleToggle = (enabled: boolean) => {
    setIsEnabled(enabled);
    if (enabled) {
      enableNotifications.mutate({ credentialId });
    } else {
      disableNotifications.mutate({ credentialId });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {slackConfig && (
        <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium">
              Slack integration configured for #{slackConfig.channelName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="slack-enabled" className="text-sm">
              {isEnabled ? 'Enabled' : 'Disabled'}
            </Label>
            <Switch
              id="slack-enabled"
              checked={isEnabled}
              onCheckedChange={handleToggle}
              disabled={enableNotifications.isPending || disableNotifications.isPending}
            />
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Label htmlFor="webhook-url">Slack Webhook URL</Label>
          <Input
            id="webhook-url"
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Get your webhook URL from{' '}
            <a
              href="https://api.slack.com/messaging/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Slack Incoming Webhooks
            </a>
          </p>
        </div>

        <div>
          <Label htmlFor="channel-name">Channel Name</Label>
          <Input
            id="channel-name"
            placeholder="alerts"
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            The name of the Slack channel (without #)
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={configureWebhook.isPending || !webhookUrl || !channelName}
          >
            {configureWebhook.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Configuration
          </Button>

          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testWebhook.isPending || !webhookUrl}
          >
            {testWebhook.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Test Connection
          </Button>
        </div>
      </div>

      <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h4 className="text-sm font-medium mb-2">How it works:</h4>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li>Configure your Slack webhook URL and channel name</li>
          <li>Test the connection to ensure messages are delivered</li>
          <li>Enable notifications to receive real-time alerts</li>
          <li>Critical, warning, and info alerts will be sent automatically</li>
          <li>Toggle notifications on/off anytime without losing configuration</li>
        </ul>
      </div>
    </div>
  );
}
