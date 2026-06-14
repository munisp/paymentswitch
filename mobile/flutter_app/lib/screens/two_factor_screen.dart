import 'package:flutter/material.dart';
import '../services/api_service.dart';

class TwoFactorScreen extends StatefulWidget {
  const TwoFactorScreen({super.key});
  @override
  State<TwoFactorScreen> createState() => _TwoFactorScreenState();
}

class _TwoFactorScreenState extends State<TwoFactorScreen> {
  final ApiService _api = ApiService();
  bool _loading = true;
  bool _twoFactorEnabled = false;
  String _method = 'totp';
  String _qrCodeUrl = '';

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getTwoFactorStatus();
      final data = response.data;
      final status = data['result']?['data'] ?? {};
      setState(() {
        _twoFactorEnabled = status['enabled'] ?? false;
        _method = status['method'] ?? 'totp';
        _qrCodeUrl = status['qr_code_url'] ?? '';
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  Future<void> _toggleTwoFactor() async {
    if (_twoFactorEnabled) {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Disable 2FA'),
          content: const Text('Are you sure you want to disable two-factor authentication? This reduces your account security.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Disable', style: TextStyle(color: Colors.red))),
          ],
        ),
      );
      if (confirm != true) return;
    }

    await _api.enableTwoFactor({'enabled': !_twoFactorEnabled, 'method': _method});
    _loadStatus();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Two-Factor Authentication')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(_twoFactorEnabled ? Icons.security : Icons.shield_outlined,
                              color: _twoFactorEnabled ? Colors.green : Colors.orange, size: 32),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(_twoFactorEnabled ? '2FA Enabled' : '2FA Disabled',
                                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                                  Text(_twoFactorEnabled
                                    ? 'Your account is protected with two-factor authentication'
                                    : 'Enable 2FA to add an extra layer of security',
                                    style: const TextStyle(color: Colors.grey)),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: _toggleTwoFactor,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _twoFactorEnabled ? Colors.red : Colors.green,
                            ),
                            child: Text(_twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text('Authentication Method', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                RadioListTile<String>(
                  title: const Text('Authenticator App (TOTP)'),
                  subtitle: const Text('Use Google Authenticator or Authy'),
                  value: 'totp',
                  groupValue: _method,
                  onChanged: (v) => setState(() => _method = v ?? 'totp'),
                ),
                RadioListTile<String>(
                  title: const Text('SMS'),
                  subtitle: const Text('Receive codes via SMS'),
                  value: 'sms',
                  groupValue: _method,
                  onChanged: (v) => setState(() => _method = v ?? 'sms'),
                ),
                if (_qrCodeUrl.isNotEmpty && _twoFactorEnabled) ...[
                  const SizedBox(height: 16),
                  const Text('Scan QR Code', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Center(child: Text('QR Code available at: $_qrCodeUrl', textAlign: TextAlign.center)),
                ],
              ],
            ),
    );
  }
}
