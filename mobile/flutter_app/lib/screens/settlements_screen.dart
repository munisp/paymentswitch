import 'package:flutter/material.dart';
import '../services/api_service.dart';

class SettlementsScreen extends StatefulWidget {
  const SettlementsScreen({super.key});
  @override
  State<SettlementsScreen> createState() => _SettlementsScreenState();
}

class _SettlementsScreenState extends State<SettlementsScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _settlements = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadSettlements();
  }

  Future<void> _loadSettlements() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getSettlements();
      final data = response.data;
      setState(() {
        _settlements = List<Map<String, dynamic>>.from(data['result']?['data']?['settlements'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'SETTLED': return Colors.green;
      case 'PENDING': return Colors.orange;
      case 'PROCESSING': return Colors.blue;
      case 'FAILED': return Colors.red;
      case 'RECONCILING': return Colors.purple;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settlements')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadSettlements,
              child: _settlements.isEmpty
                  ? const Center(child: Text('No settlements found'))
                  : ListView.builder(
                      itemCount: _settlements.length,
                      itemBuilder: (context, index) {
                        final s = _settlements[index];
                        final status = s['status'] ?? 'PENDING';
                        final netAmount = s['net_amount'] ?? 0;
                        return Card(
                          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(s['id'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: _statusColor(status).withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(status, style: TextStyle(color: _statusColor(status), fontSize: 12, fontWeight: FontWeight.w600)),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text('Bank: ${s['bank_name'] ?? 'Unknown'}'),
                                Text('Net Amount: NGN ${netAmount is num ? netAmount.toStringAsFixed(2) : netAmount}'),
                                Text('Transactions: ${s['total_transactions'] ?? 0}'),
                                if (s['date'] != null) Text('Date: ${s['date']}', style: const TextStyle(color: Colors.grey)),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
