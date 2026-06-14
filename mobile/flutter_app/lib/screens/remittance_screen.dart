import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';
import '../utils/validators.dart';

class RemittanceScreen extends StatefulWidget {
  const RemittanceScreen({super.key});
  @override
  State<RemittanceScreen> createState() => _RemittanceScreenState();
}

class _RemittanceScreenState extends State<RemittanceScreen> {
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
      final response = await _api.getRemittances();
      final data = response.data;
      setState(() {
        _remittances = List<Map<String, dynamic>>.from(data['result']?['data']?['remittances'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Remittances')),
      floatingActionButton: FloatingActionButton(onPressed: () => _showNewRemittance(context), child: const Icon(Icons.send)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _remittances.isEmpty
              ? const Center(child: Text('No remittances'))
              : RefreshIndicator(
                  onRefresh: _loadRemittances,
                  child: ListView.builder(
                    itemCount: _remittances.length,
                    itemBuilder: (context, i) {
                      final r = _remittances[i];
                      final status = r['status'] ?? 'pending';
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: Colors.blue.shade100,
                            child: Text('${r['destination_country'] ?? '??'}', style: const TextStyle(fontSize: 12)),
                          ),
                          title: Text('${r['recipient_name'] ?? 'Recipient'}'),
                          subtitle: Text('${r['source_amount'] ?? 0} ${r['source_currency'] ?? 'NGN'} → ${r['dest_amount'] ?? 0} ${r['dest_currency'] ?? 'USD'}'),
                          trailing: Column(mainAxisSize: MainAxisSize.min, children: [
                            Chip(label: Text(status, style: const TextStyle(fontSize: 10)), backgroundColor: status == 'completed' ? Colors.green.shade100 : Colors.orange.shade100),
                            Text(r['created_at'] ?? '', style: const TextStyle(fontSize: 10)),
                          ]),
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  void _showNewRemittance(BuildContext context) {
    final formKey = GlobalKey<FormState>();
    final recipientCtrl = TextEditingController();
    final amountCtrl = TextEditingController();
    final accountCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom, left: 16, right: 16, top: 16),
        child: Form(
          key: formKey,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('New Remittance', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            TextFormField(
              controller: recipientCtrl,
              decoration: const InputDecoration(labelText: 'Recipient Name', border: OutlineInputBorder()),
              validator: Validators.recipientName,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: accountCtrl,
              decoration: const InputDecoration(labelText: 'Account Number', border: OutlineInputBorder()),
              validator: Validators.accountNumber,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: amountCtrl,
              decoration: const InputDecoration(labelText: 'Amount (NGN)', border: OutlineInputBorder(), prefixText: '₦ '),
              validator: (v) => Validators.amount(v, min: 100, max: 50000000),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))],
            ),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: ElevatedButton(
              onPressed: () async {
                if (!formKey.currentState!.validate()) return;
                await _api.createRemittance({'recipient_name': recipientCtrl.text, 'account_number': accountCtrl.text, 'amount': double.tryParse(amountCtrl.text.replaceAll(',', '')) ?? 0, 'source_currency': 'NGN', 'dest_currency': 'USD'});
                if (mounted) Navigator.pop(ctx);
                _loadRemittances();
              },
              child: const Text('Send Remittance'),
            )),
            const SizedBox(height: 16),
          ]),
        ),
      ),
    );
  }
}
