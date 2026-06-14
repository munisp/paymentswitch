import 'package:flutter/material.dart';
import '../services/api_service.dart';

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});
  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  final ApiService _api = ApiService();
  bool _loading = true;
  bool _pushEnabled = true;
  bool _emailEnabled = true;
  bool _smsEnabled = false;
  bool _transferAlerts = true;
  bool _securityAlerts = true;
  bool _rateAlerts = false;
  bool _marketingEmails = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getNotificationSettings();
      final data = response.data;
      final settings = data['result']?['data'] ?? {};
      setState(() {
        _pushEnabled = settings['push_enabled'] ?? true;
        _emailEnabled = settings['email_enabled'] ?? true;
        _smsEnabled = settings['sms_enabled'] ?? false;
        _transferAlerts = settings['transfer_alerts'] ?? true;
        _securityAlerts = settings['security_alerts'] ?? true;
        _rateAlerts = settings['rate_alerts'] ?? false;
        _marketingEmails = settings['marketing_emails'] ?? false;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  Future<void> _saveSettings() async {
    await _api.updateNotificationSettings({
      'push_enabled': _pushEnabled,
      'email_enabled': _emailEnabled,
      'sms_enabled': _smsEnabled,
      'transfer_alerts': _transferAlerts,
      'security_alerts': _securityAlerts,
      'rate_alerts': _rateAlerts,
      'marketing_emails': _marketingEmails,
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Settings saved')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notification Settings'),
        actions: [
          TextButton(onPressed: _saveSettings, child: const Text('Save')),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                const Padding(padding: EdgeInsets.all(16), child: Text('Channels', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold))),
                SwitchListTile(title: const Text('Push Notifications'), subtitle: const Text('Receive push notifications on this device'), value: _pushEnabled, onChanged: (v) => setState(() => _pushEnabled = v)),
                SwitchListTile(title: const Text('Email Notifications'), subtitle: const Text('Receive email alerts'), value: _emailEnabled, onChanged: (v) => setState(() => _emailEnabled = v)),
                SwitchListTile(title: const Text('SMS Notifications'), subtitle: const Text('Receive SMS alerts (charges may apply)'), value: _smsEnabled, onChanged: (v) => setState(() => _smsEnabled = v)),
                const Divider(),
                const Padding(padding: EdgeInsets.all(16), child: Text('Alert Types', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold))),
                SwitchListTile(title: const Text('Transfer Alerts'), subtitle: const Text('Notifications for transfers and payments'), value: _transferAlerts, onChanged: (v) => setState(() => _transferAlerts = v)),
                SwitchListTile(title: const Text('Security Alerts'), subtitle: const Text('Login attempts and security events'), value: _securityAlerts, onChanged: (v) => setState(() => _securityAlerts = v)),
                SwitchListTile(title: const Text('Rate Alerts'), subtitle: const Text('FX rate change notifications'), value: _rateAlerts, onChanged: (v) => setState(() => _rateAlerts = v)),
                SwitchListTile(title: const Text('Marketing'), subtitle: const Text('Product updates and promotions'), value: _marketingEmails, onChanged: (v) => setState(() => _marketingEmails = v)),
              ],
            ),
    );
  }
}
