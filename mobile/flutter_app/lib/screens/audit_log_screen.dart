import 'package:flutter/material.dart';
import '../services/api_service.dart';

class AuditLogScreen extends StatefulWidget {
  const AuditLogScreen({super.key});
  @override
  State<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends State<AuditLogScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _logs = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadLogs();
  }

  Future<void> _loadLogs() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getAuditLogs();
      final data = response.data;
      setState(() {
        _logs = List<Map<String, dynamic>>.from(data['result']?['data']?['logs'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Audit Log'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _loadLogs)],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _logs.isEmpty
              ? const Center(child: Text('No audit logs found'))
              : RefreshIndicator(
                  onRefresh: _loadLogs,
                  child: ListView.builder(
                    itemCount: _logs.length,
                    itemBuilder: (context, i) {
                      final log = _logs[i];
                      return ListTile(
                        leading: Icon(_getEventIcon(log['action'] ?? ''), color: _getEventColor(log['severity'] ?? 'info')),
                        title: Text(log['action'] ?? 'Unknown Event'),
                        subtitle: Text('${log['actor'] ?? 'System'} • ${log['timestamp'] ?? ''}'),
                        trailing: Chip(label: Text(log['severity'] ?? 'info', style: const TextStyle(fontSize: 10)), backgroundColor: _getEventColor(log['severity'] ?? 'info').withOpacity(0.1)),
                      );
                    },
                  ),
                ),
    );
  }

  IconData _getEventIcon(String action) {
    if (action.contains('login')) return Icons.login;
    if (action.contains('transfer')) return Icons.swap_horiz;
    if (action.contains('config')) return Icons.settings;
    return Icons.history;
  }

  Color _getEventColor(String severity) {
    switch (severity) {
      case 'critical': return Colors.red;
      case 'warning': return Colors.orange;
      case 'info': return Colors.blue;
      default: return Colors.grey;
    }
  }
}
