import 'package:flutter/material.dart';
import '../services/api_service.dart';

class FeesScreen extends StatefulWidget {
  const FeesScreen({super.key});
  @override
  State<FeesScreen> createState() => _FeesScreenState();
}

class _FeesScreenState extends State<FeesScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _fees = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadFees();
  }

  Future<void> _loadFees() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getFeeConfigurations();
      final data = response.data;
      setState(() {
        _fees = List<Map<String, dynamic>>.from(data['result']?['data']?['fees'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fee Schedule')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _fees.isEmpty
              ? const Center(child: Text('No fee configurations'))
              : RefreshIndicator(
                  onRefresh: _loadFees,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _fees.length,
                    itemBuilder: (context, i) {
                      final fee = _fees[i];
                      return Card(child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(fee['name'] ?? 'Fee Tier ${i + 1}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                          const SizedBox(height: 8),
                          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                            _FeeDetail(label: 'Flat Fee', value: '₦${fee['flat_fee'] ?? 0}'),
                            _FeeDetail(label: 'Percentage', value: '${fee['percentage'] ?? 0}%'),
                            _FeeDetail(label: 'Min', value: '₦${fee['min_fee'] ?? 0}'),
                            _FeeDetail(label: 'Max', value: '₦${fee['max_fee'] ?? 0}'),
                          ]),
                        ]),
                      ));
                    },
                  ),
                ),
    );
  }
}

class _FeeDetail extends StatelessWidget {
  final String label, value;
  const _FeeDetail({required this.label, required this.value});
  @override
  Widget build(BuildContext context) => Column(children: [
    Text(label, style: Theme.of(context).textTheme.bodySmall),
    const SizedBox(height: 4),
    Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
  ]);
}
