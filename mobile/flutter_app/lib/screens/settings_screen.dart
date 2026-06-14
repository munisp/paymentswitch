import 'package:flutter/material.dart';
import '../services/api_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final ApiService _api = ApiService();
  Map<String, dynamic> _prefs = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadPreferences();
  }

  Future<void> _loadPreferences() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getPreferences();
      setState(() {
        _prefs = Map<String, dynamic>.from(response.data['result']?['data'] ?? {});
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  Future<void> _updatePref(String key, dynamic value) async {
    setState(() => _prefs[key] = value);
    try {
      await _api.updatePreferences({key: value});
    } catch (e) {
      _loadPreferences();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(children: [
              const _SectionHeader(title: 'Notifications'),
              SwitchListTile(
                title: const Text('Push Notifications'),
                subtitle: const Text('Receive transaction alerts'),
                value: _prefs['push_notifications'] == true,
                onChanged: (v) => _updatePref('push_notifications', v),
              ),
              SwitchListTile(
                title: const Text('Email Notifications'),
                subtitle: const Text('Receive email summaries'),
                value: _prefs['email_notifications'] == true,
                onChanged: (v) => _updatePref('email_notifications', v),
              ),
              SwitchListTile(
                title: const Text('SMS Alerts'),
                subtitle: const Text('Receive SMS for high-value transactions'),
                value: _prefs['sms_alerts'] == true,
                onChanged: (v) => _updatePref('sms_alerts', v),
              ),
              const _SectionHeader(title: 'Security'),
              SwitchListTile(
                title: const Text('Biometric Login'),
                subtitle: const Text('Use fingerprint or face ID'),
                value: _prefs['biometric_login'] == true,
                onChanged: (v) => _updatePref('biometric_login', v),
              ),
              SwitchListTile(
                title: const Text('Two-Factor Authentication'),
                subtitle: const Text('Extra security for sign-in'),
                value: _prefs['two_factor'] == true,
                onChanged: (v) => _updatePref('two_factor', v),
              ),
              const _SectionHeader(title: 'Display'),
              ListTile(
                title: const Text('Currency'),
                subtitle: Text(_prefs['currency'] ?? 'NGN'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {},
              ),
              ListTile(
                title: const Text('Language'),
                subtitle: Text(_prefs['language'] ?? 'English'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {},
              ),
              const _SectionHeader(title: 'Account'),
              ListTile(
                title: const Text('Change Password'),
                leading: const Icon(Icons.lock_outline),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {},
              ),
              ListTile(
                title: const Text('Export Data'),
                leading: const Icon(Icons.download),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {},
              ),
              ListTile(
                title: const Text('Delete Account', style: TextStyle(color: Colors.red)),
                leading: const Icon(Icons.delete_forever, color: Colors.red),
                onTap: () {},
              ),
            ]),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
    child: Text(title, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.grey.shade600, letterSpacing: 1)),
  );
}
