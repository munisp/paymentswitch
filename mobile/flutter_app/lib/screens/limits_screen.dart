import 'package:flutter/material.dart';
import '../services/api_service.dart';

class LimitsScreen extends StatefulWidget {
  const LimitsScreen({super.key});
  @override
  State<LimitsScreen> createState() => _LimitsScreenState();
}

class _LimitsScreenState extends State<LimitsScreen> {
  final ApiService _api = ApiService();
  Map<String, dynamic> _limits = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadLimits();
  }

  Future<void> _loadLimits() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getMyLimits();
      final data = response.data;
      setState(() {
        _limits = Map<String, dynamic>.from(data['result']?['data'] ?? {});
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Transaction Limits')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _limits.isEmpty
              ? const Center(child: Text('No limits configured'))
              : RefreshIndicator(
                  onRefresh: _loadLimits,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildLimitCard('Daily Transfer', _limits['daily_transfer'] ?? {}, Colors.blue),
                      _buildLimitCard('Monthly Transfer', _limits['monthly_transfer'] ?? {}, Colors.green),
                      _buildLimitCard('Single Transaction', _limits['single_transaction'] ?? {}, Colors.orange),
                      _buildLimitCard('International', _limits['international'] ?? {}, Colors.purple),
                    ],
                  ),
                ),
    );
  }

  Widget _buildLimitCard(String title, Map<String, dynamic> limit, Color color) {
    final used = (limit['used'] ?? 0).toDouble();
    final max = (limit['max'] ?? 1).toDouble();
    final percentage = max > 0 ? (used / max).clamp(0.0, 1.0) : 0.0;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          LinearProgressIndicator(value: percentage, backgroundColor: color.withOpacity(0.1), valueColor: AlwaysStoppedAnimation(color)),
          const SizedBox(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text('Used: ₦${used.toStringAsFixed(0)}'),
            Text('Limit: ₦${max.toStringAsFixed(0)}', style: TextStyle(color: Colors.grey.shade600)),
          ]),
        ]),
      ),
    );
  }
}
