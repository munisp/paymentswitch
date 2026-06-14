import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({super.key});
  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  final ApiService _api = ApiService();
  String _referralCode = '';
  List<Map<String, dynamic>> _referrals = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadReferralData();
  }

  Future<void> _loadReferralData() async {
    setState(() => _loading = true);
    try {
      final codeResp = await _api.getMyReferralCode();
      final referralsResp = await _api.getMyReferrals();
      setState(() {
        _referralCode = codeResp.data['result']?['data']?['code'] ?? '';
        _referrals = List<Map<String, dynamic>>.from(referralsResp.data['result']?['data']?['referrals'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Referral Program')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadReferralData,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Card(
                  color: Colors.blue.shade50,
                  child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [
                    const Text('Your Referral Code', style: TextStyle(fontSize: 14, color: Colors.grey)),
                    const SizedBox(height: 8),
                    Text(_referralCode.isEmpty ? 'No code yet' : _referralCode, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 4)),
                    const SizedBox(height: 12),
                    ElevatedButton.icon(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: _referralCode));
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Code copied!')));
                      },
                      icon: const Icon(Icons.copy, size: 18),
                      label: const Text('Copy Code'),
                    ),
                  ])),
                ),
                const SizedBox(height: 16),
                Text('Referrals (${_referrals.length})', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                ..._referrals.map((r) => ListTile(
                  leading: CircleAvatar(child: Text(r['name']?.substring(0, 1) ?? '?')),
                  title: Text(r['name'] ?? 'User'),
                  subtitle: Text('Joined: ${r['joined_at'] ?? ''}'),
                  trailing: Chip(
                    label: Text(r['status'] ?? 'active', style: const TextStyle(fontSize: 10)),
                    backgroundColor: r['status'] == 'rewarded' ? Colors.green.shade100 : Colors.blue.shade100,
                  ),
                )),
              ]),
            ),
    );
  }
}
