import 'package:flutter/material.dart';
import '../services/api_service.dart';

class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key});
  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  final ApiService _api = ApiService();
  Map<String, dynamic> _score = {};
  List<Map<String, dynamic>> _events = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadSecurity();
  }

  Future<void> _loadSecurity() async {
    setState(() => _loading = true);
    try {
      final scoreResp = await _api.getSecurityScore();
      final eventsResp = await _api.getSecurityEvents();
      setState(() {
        _score = Map<String, dynamic>.from(scoreResp.data['result']?['data'] ?? {});
        _events = List<Map<String, dynamic>>.from(eventsResp.data['result']?['data']?['events'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scoreValue = (_score['score'] ?? 0).toDouble();
    return Scaffold(
      appBar: AppBar(title: const Text('Security')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadSecurity,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Card(
                  child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [
                    const Text('Security Score', style: TextStyle(fontSize: 14, color: Colors.grey)),
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 100, width: 100,
                      child: Stack(alignment: Alignment.center, children: [
                        CircularProgressIndicator(value: scoreValue / 100, strokeWidth: 8, backgroundColor: Colors.grey.shade200, valueColor: AlwaysStoppedAnimation(scoreValue >= 80 ? Colors.green : scoreValue >= 50 ? Colors.orange : Colors.red)),
                        Text('${scoreValue.toInt()}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    Text(_score['recommendation'] ?? 'Enable 2FA for better security', style: const TextStyle(fontSize: 12)),
                  ])),
                ),
                const SizedBox(height: 16),
                const Text('Recent Security Events', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                ..._events.map((e) => ListTile(
                  leading: Icon(
                    e['type'] == 'login' ? Icons.login : e['type'] == 'password_change' ? Icons.lock : Icons.warning,
                    color: e['severity'] == 'high' ? Colors.red : Colors.blue,
                  ),
                  title: Text(e['description'] ?? e['type'] ?? 'Event'),
                  subtitle: Text('${e['ip_address'] ?? ''} • ${e['timestamp'] ?? ''}'),
                )),
                if (_events.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(20), child: Text('No recent events'))),
              ]),
            ),
    );
  }
}
