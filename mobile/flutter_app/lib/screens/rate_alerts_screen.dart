import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../utils/validators.dart';

class RateAlertsScreen extends StatefulWidget {
  const RateAlertsScreen({super.key});
  @override
  State<RateAlertsScreen> createState() => _RateAlertsScreenState();
}

class _RateAlertsScreenState extends State<RateAlertsScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _alerts = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadAlerts();
  }

  Future<void> _loadAlerts() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getRateAlerts();
      final data = response.data;
      setState(() {
        _alerts = List<Map<String, dynamic>>.from(data['result']?['data']?['alerts'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  void _showCreateAlert() {
    final formKey = GlobalKey<FormState>();
    final corridorCtrl = TextEditingController();
    final targetRateCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Create Rate Alert', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              TextFormField(
                controller: corridorCtrl,
                decoration: const InputDecoration(labelText: 'Corridor (e.g. NG-US)', border: OutlineInputBorder()),
                validator: (v) {
                  final base = Validators.required(v, 'Corridor');
                  if (base != null) return base;
                  final pattern = RegExp(r'^[A-Z]{2}-[A-Z]{2}$');
                  if (!pattern.hasMatch(v!.trim().toUpperCase())) return 'Use format XX-XX (e.g. NG-US)';
                  return null;
                },
                textCapitalization: TextCapitalization.characters,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: targetRateCtrl,
                decoration: const InputDecoration(labelText: 'Target Rate', border: OutlineInputBorder()),
                keyboardType: TextInputType.number,
                validator: (v) => Validators.amount(v, min: 0.01, max: 99999),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () async {
                    if (!formKey.currentState!.validate()) return;
                    await _api.createRateAlert({
                      'corridor': corridorCtrl.text.trim().toUpperCase(),
                      'targetRate': double.tryParse(targetRateCtrl.text) ?? 0,
                    });
                    if (context.mounted) Navigator.pop(ctx);
                    _loadAlerts();
                  },
                  child: const Text('Create Alert'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rate Alerts')),
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateAlert,
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadAlerts,
              child: _alerts.isEmpty
                  ? const Center(child: Text('No rate alerts configured'))
                  : ListView.builder(
                      itemCount: _alerts.length,
                      itemBuilder: (context, index) {
                        final a = _alerts[index];
                        return Card(
                          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                          child: ListTile(
                            leading: const CircleAvatar(child: Icon(Icons.trending_up)),
                            title: Text(a['corridor'] ?? 'Unknown'),
                            subtitle: Text('Target: ${a['target_rate'] ?? '-'} • Current: ${a['current_rate'] ?? '-'}'),
                            trailing: Switch(
                              value: a['active'] == true,
                              onChanged: null,
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
