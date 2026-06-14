import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../utils/validators.dart';

class BatchTransferScreen extends StatefulWidget {
  const BatchTransferScreen({super.key});
  @override
  State<BatchTransferScreen> createState() => _BatchTransferScreenState();
}

class _BatchTransferScreenState extends State<BatchTransferScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _batches = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadBatches();
  }

  Future<void> _loadBatches() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getBatchTransfers();
      final data = response.data;
      setState(() {
        _batches = List<Map<String, dynamic>>.from(data['result']?['data']?['batches'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Batch Transfers')),
      floatingActionButton: FloatingActionButton(onPressed: () => _showCreateBatch(context), child: const Icon(Icons.add)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _batches.isEmpty
              ? const Center(child: Text('No batch transfers'))
              : RefreshIndicator(
                  onRefresh: _loadBatches,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _batches.length,
                    itemBuilder: (context, i) {
                      final b = _batches[i];
                      final status = b['status'] ?? 'pending';
                      return Card(child: ListTile(
                        leading: CircleAvatar(child: Text('${b['item_count'] ?? 0}')),
                        title: Text(b['name'] ?? 'Batch #${b['id'] ?? i}'),
                        subtitle: Text('Total: ₦${b['total_amount'] ?? 0} • ${b['created_at'] ?? ''}'),
                        trailing: Chip(
                          label: Text(status, style: const TextStyle(fontSize: 10)),
                          backgroundColor: status == 'completed' ? Colors.green.shade100 : Colors.orange.shade100,
                        ),
                      ));
                    },
                  ),
                ),
    );
  }

  void _showCreateBatch(BuildContext context) {
    final formKey = GlobalKey<FormState>();
    final nameCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Batch Transfer'),
        content: Form(
          key: formKey,
          child: TextFormField(
            controller: nameCtrl,
            decoration: const InputDecoration(labelText: 'Batch Name', border: OutlineInputBorder(), hintText: 'e.g. June Salary Payments'),
            validator: (v) => Validators.required(v, 'Batch name'),
            autofocus: true,
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              if (!formKey.currentState!.validate()) return;
              await _api.createBatchTransfer({'name': nameCtrl.text});
              Navigator.pop(ctx);
              _loadBatches();
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}
