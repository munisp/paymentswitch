import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ComplianceScreen extends StatefulWidget {
  const ComplianceScreen({super.key});
  @override
  State<ComplianceScreen> createState() => _ComplianceScreenState();
}

class _ComplianceScreenState extends State<ComplianceScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _reports = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadReports();
  }

  Future<void> _loadReports() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getComplianceReports();
      final data = response.data;
      setState(() {
        _reports = List<Map<String, dynamic>>.from(data['result']?['data']?['reports'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Compliance')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _reports.isEmpty
              ? const Center(child: Text('No compliance reports'))
              : RefreshIndicator(
                  onRefresh: _loadReports,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _reports.length,
                    itemBuilder: (context, i) {
                      final r = _reports[i];
                      final status = r['status'] ?? 'pending';
                      return Card(child: ListTile(
                        leading: Icon(
                          status == 'submitted' ? Icons.check_circle : Icons.pending,
                          color: status == 'submitted' ? Colors.green : Colors.orange,
                        ),
                        title: Text(r['name'] ?? 'Report ${i + 1}'),
                        subtitle: Text('Type: ${r['type'] ?? 'regulatory'} • Due: ${r['due_date'] ?? ''}'),
                        trailing: Text(status, style: TextStyle(color: status == 'submitted' ? Colors.green : Colors.orange, fontWeight: FontWeight.bold, fontSize: 12)),
                      ));
                    },
                  ),
                ),
    );
  }
}
