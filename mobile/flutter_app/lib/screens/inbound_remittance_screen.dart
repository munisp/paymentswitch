import 'package:flutter/material.dart';
import '../services/api_service.dart';

class InboundRemittanceScreen extends StatefulWidget {
  const InboundRemittanceScreen({super.key});
  @override
  State<InboundRemittanceScreen> createState() => _InboundRemittanceScreenState();
}

class _InboundRemittanceScreenState extends State<InboundRemittanceScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _remittances = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadRemittances();
  }

  Future<void> _loadRemittances() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getInboundRemittances();
      final data = response.data;
      setState(() {
        _remittances = List<Map<String, dynamic>>.from(data['result']?['data']?['transfers'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'completed': return Colors.green;
      case 'pending': return Colors.orange;
      case 'processing': return Colors.blue;
      case 'failed': return Colors.red;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Inbound Remittances')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadRemittances,
              child: _remittances.isEmpty
                  ? const Center(child: Text('No inbound remittances'))
                  : ListView.builder(
                      itemCount: _remittances.length,
                      itemBuilder: (context, index) {
                        final r = _remittances[index];
                        final status = r['status'] ?? 'unknown';
                        return Card(
                          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                          child: ListTile(
                            leading: const CircleAvatar(child: Icon(Icons.call_received, color: Colors.green)),
                            title: Text('${r['source_currency'] ?? ''} ${r['source_amount'] ?? '0'} → NGN ${r['destination_amount'] ?? '0'}'),
                            subtitle: Text('From: ${r['sender_name'] ?? 'Unknown'} • ${r['corridor'] ?? ''}'),
                            trailing: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _statusColor(status).withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(status.toUpperCase(), style: TextStyle(color: _statusColor(status), fontSize: 12, fontWeight: FontWeight.w600)),
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
