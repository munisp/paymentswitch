import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';
import '../utils/validators.dart';

class DisputesScreen extends StatefulWidget {
  const DisputesScreen({super.key});
  @override
  State<DisputesScreen> createState() => _DisputesScreenState();
}

class _DisputesScreenState extends State<DisputesScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _disputes = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadDisputes();
  }

  Future<void> _loadDisputes() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getDisputes();
      final data = response.data;
      setState(() {
        _disputes = List<Map<String, dynamic>>.from(data['result']?['data']?['disputes'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Disputes')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateDispute(context),
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _disputes.isEmpty
              ? const Center(child: Text('No disputes'))
              : RefreshIndicator(
                  onRefresh: _loadDisputes,
                  child: ListView.builder(
                    itemCount: _disputes.length,
                    itemBuilder: (context, i) {
                      final d = _disputes[i];
                      final status = d['status'] ?? 'open';
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: status == 'resolved' ? Colors.green.shade100 : Colors.orange.shade100,
                            child: Icon(Icons.gavel, color: status == 'resolved' ? Colors.green : Colors.orange),
                          ),
                          title: Text(d['reason'] ?? 'Dispute #${d['id'] ?? i}'),
                          subtitle: Text('Amount: ₦${d['amount'] ?? 0} • ${d['created_at'] ?? ''}'),
                          trailing: Chip(label: Text(status, style: const TextStyle(fontSize: 10))),
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  void _showCreateDispute(BuildContext context) {
    final formKey = GlobalKey<FormState>();
    final reasonController = TextEditingController();
    final amountController = TextEditingController();
    final txnRefController = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom, left: 16, right: 16, top: 16),
        child: Form(
          key: formKey,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('Create Dispute', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            TextFormField(
              controller: txnRefController,
              decoration: const InputDecoration(labelText: 'Transaction Reference', border: OutlineInputBorder()),
              validator: Validators.transactionRef,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: reasonController,
              decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder(), hintText: 'Describe the issue in detail'),
              validator: Validators.disputeReason,
              maxLines: 3,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: amountController,
              decoration: const InputDecoration(labelText: 'Disputed Amount', border: OutlineInputBorder(), prefixText: '₦ '),
              validator: (v) => Validators.amount(v, min: 1),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))],
            ),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: ElevatedButton(
              onPressed: () async {
                if (!formKey.currentState!.validate()) return;
                await _api.createDispute({'transaction_ref': txnRefController.text, 'reason': reasonController.text, 'amount': double.tryParse(amountController.text.replaceAll(',', '')) ?? 0});
                if (mounted) Navigator.pop(ctx);
                _loadDisputes();
              },
              child: const Text('Submit Dispute'),
            )),
            const SizedBox(height: 16),
          ]),
        ),
      ),
    );
  }
}
