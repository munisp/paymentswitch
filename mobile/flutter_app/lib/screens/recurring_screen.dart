import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';
import '../utils/validators.dart';

class RecurringScreen extends StatefulWidget {
  const RecurringScreen({super.key});
  @override
  State<RecurringScreen> createState() => _RecurringScreenState();
}

class _RecurringScreenState extends State<RecurringScreen> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _recurring = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadRecurring();
  }

  Future<void> _loadRecurring() async {
    setState(() => _loading = true);
    try {
      final response = await _api.getRecurringRemittances();
      final data = response.data;
      setState(() {
        _recurring = List<Map<String, dynamic>>.from(data['result']?['data']?['recurring'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recurring Payments')),
      floatingActionButton: FloatingActionButton(onPressed: () => _showCreateRecurring(context), child: const Icon(Icons.add)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _recurring.isEmpty
              ? const Center(child: Text('No recurring payments'))
              : RefreshIndicator(
                  onRefresh: _loadRecurring,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _recurring.length,
                    itemBuilder: (context, i) {
                      final r = _recurring[i];
                      return Card(child: ListTile(
                        leading: const CircleAvatar(child: Icon(Icons.repeat)),
                        title: Text(r['recipient_name'] ?? 'Recipient ${i + 1}'),
                        subtitle: Text('₦${r['amount'] ?? 0} • ${r['frequency'] ?? 'monthly'}'),
                        trailing: Switch(
                          value: r['active'] == true,
                          onChanged: (val) {},
                        ),
                      ));
                    },
                  ),
                ),
    );
  }

  void _showCreateRecurring(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        final recipientCtrl = TextEditingController();
        final amountCtrl = TextEditingController();
        String frequency = 'monthly';
        final formKey = GlobalKey<FormState>();
        return StatefulBuilder(builder: (ctx, setModalState) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom, left: 16, right: 16, top: 16),
          child: Form(
            key: formKey,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('New Recurring Payment', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            TextFormField(
              controller: recipientCtrl,
              decoration: const InputDecoration(labelText: 'Recipient', border: OutlineInputBorder()),
              validator: Validators.recipientName,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: amountCtrl,
              decoration: const InputDecoration(labelText: 'Amount', border: OutlineInputBorder(), prefixText: '\u20A6 '),
              validator: (v) => Validators.amount(v, min: 100),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))],
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: frequency,
              decoration: const InputDecoration(labelText: 'Frequency', border: OutlineInputBorder()),
              items: const [
                DropdownMenuItem(value: 'daily', child: Text('Daily')),
                DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
              ],
              onChanged: (v) => setModalState(() => frequency = v!),
            ),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: ElevatedButton(
              onPressed: () async {
                if (!formKey.currentState!.validate()) return;
                await _api.createRecurringRemittance({'recipient': recipientCtrl.text, 'amount': double.tryParse(amountCtrl.text.replaceAll(',', '')) ?? 0, 'frequency': frequency});
                if (mounted) Navigator.pop(ctx);
                _loadRecurring();
              },
              child: const Text('Create'),
            )),
            const SizedBox(height: 16),
          ]),
        )));
      },
    );
  }
}
