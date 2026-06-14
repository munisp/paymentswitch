import 'package:flutter/material.dart';
import '../services/api_service.dart';

class AccountActivityScreen extends StatefulWidget {
  const AccountActivityScreen({super.key});
  @override
  State<AccountActivityScreen> createState() => _AccountActivityScreenState();
}

class _AccountActivityScreenState extends State<AccountActivityScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _activities = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadActivities();
  }

  Future<void> _loadActivities() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getAccountActivity();
      final data = response.data;
      setState(() {
        _activities = List<Map<String, dynamic>>.from(data['result']?['data']?['activities'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  IconData _activityIcon(String type) {
    switch (type) {
      case 'login': return Icons.login;
      case 'transfer': return Icons.swap_horiz;
      case 'payment': return Icons.payment;
      case 'kyc': return Icons.verified_user;
      case 'settings': return Icons.settings;
      default: return Icons.history;
    }
  }

  Color _activityColor(String type) {
    switch (type) {
      case 'login': return Colors.blue;
      case 'transfer': return Colors.green;
      case 'payment': return Colors.orange;
      case 'kyc': return Colors.purple;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Account Activity')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadActivities,
              child: _activities.isEmpty
                  ? const Center(child: Text('No recent activity'))
                  : ListView.separated(
                      itemCount: _activities.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final a = _activities[index];
                        final type = a['type'] ?? 'unknown';
                        return ListTile(
                          leading: CircleAvatar(
                            backgroundColor: _activityColor(type).withValues(alpha: 0.1),
                            child: Icon(_activityIcon(type), color: _activityColor(type)),
                          ),
                          title: Text(a['description'] ?? type),
                          subtitle: Text('${a['ip_address'] ?? ''} • ${a['created_at'] ?? ''}'),
                          trailing: Text(a['status'] ?? '', style: TextStyle(
                            color: a['status'] == 'success' ? Colors.green : Colors.red,
                            fontWeight: FontWeight.w500,
                          )),
                        );
                      },
                    ),
            ),
    );
  }
}
