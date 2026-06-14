import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';
import '../utils/validators.dart';

class DomesticPaymentsScreen extends StatefulWidget {
  const DomesticPaymentsScreen({super.key});

  @override
  State<DomesticPaymentsScreen> createState() => _DomesticPaymentsScreenState();
}

class _DomesticPaymentsScreenState extends State<DomesticPaymentsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final ApiService _api = ApiService();
  bool _isLoading = false;
  List<Map<String, dynamic>> _payments = [];
  String? _error;

  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _recipientController = TextEditingController();
  final _narrationController = TextEditingController();
  String _selectedType = 'NIP';
  String _selectedBank = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadPayments();
  }

  Future<void> _loadPayments() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final data = await _api.get('/api/trpc/domesticPayments.listPayments');
      setState(() { _payments = List<Map<String, dynamic>>.from(data['result']?['data'] ?? []); });
    } catch (e) {
      setState(() { _error = e.toString(); });
    } finally {
      setState(() { _isLoading = false; });
    }
  }

  Future<void> _submitPayment() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _isLoading = true; });
    try {
      await _api.post('/api/trpc/domesticPayments.createPayment', {
        'type': _selectedType,
        'amount': double.parse(_amountController.text),
        'recipientAccount': _recipientController.text,
        'recipientBank': _selectedBank,
        'narration': _narrationController.text,
      });
      _amountController.clear();
      _recipientController.clear();
      _narrationController.clear();
      _loadPayments();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Payment submitted successfully')),
      );
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Payment failed: $e'), backgroundColor: Colors.red),
      );
    } finally {
      setState(() { _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Domestic Payments'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Dashboard'),
            Tab(text: 'Send'),
            Tab(text: 'History'),
            Tab(text: 'Bills'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildDashboard(),
          _buildSendPayment(),
          _buildHistory(),
          _buildBillPayments(),
        ],
      ),
    );
  }

  Widget _buildDashboard() {
    return RefreshIndicator(
      onRefresh: _loadPayments,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _StatCard(title: 'Total Payments', value: '${_payments.length}', icon: Icons.payment),
          const SizedBox(height: 12),
          _StatCard(title: 'Pending', value: '${_payments.where((p) => p['status'] == 'pending').length}', icon: Icons.hourglass_empty, color: Colors.orange),
          const SizedBox(height: 12),
          _StatCard(title: 'Completed', value: '${_payments.where((p) => p['status'] == 'completed').length}', icon: Icons.check_circle, color: Colors.green),
        ],
      ),
    );
  }

  Widget _buildSendPayment() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              value: _selectedType,
              decoration: const InputDecoration(labelText: 'Payment Type'),
              items: ['NIP', 'NEFT', 'Direct Debit'].map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
              onChanged: (v) => setState(() { _selectedType = v!; }),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _amountController,
              decoration: const InputDecoration(labelText: 'Amount (NGN)', prefixText: '\u20A6 ', border: OutlineInputBorder()),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => Validators.amount(v, min: 1, max: 10000000),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))],
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _recipientController,
              decoration: const InputDecoration(labelText: 'Recipient Account', border: OutlineInputBorder()),
              keyboardType: TextInputType.number,
              validator: Validators.accountNumber,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _narrationController,
              decoration: const InputDecoration(labelText: 'Narration', border: OutlineInputBorder()),
              validator: Validators.narration,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _isLoading ? null : _submitPayment,
              child: _isLoading
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Send Payment'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHistory() {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return Center(child: Text('Error: $_error'));
    if (_payments.isEmpty) return const Center(child: Text('No payments yet'));
    return ListView.builder(
      itemCount: _payments.length,
      itemBuilder: (ctx, i) {
        final p = _payments[i];
        return ListTile(
          leading: Icon(p['status'] == 'completed' ? Icons.check_circle : Icons.pending, color: p['status'] == 'completed' ? Colors.green : Colors.orange),
          title: Text('₦${p['amount'] ?? 0}'),
          subtitle: Text('${p['type'] ?? 'NIP'} • ${p['reference'] ?? ''}'),
          trailing: Text(p['status'] ?? ''),
        );
      },
    );
  }

  Widget _buildBillPayments() {
    return const Center(child: Text('Bill Payments - Coming Soon'));
  }

  @override
  void dispose() {
    _tabController.dispose();
    _amountController.dispose();
    _recipientController.dispose();
    _narrationController.dispose();
    super.dispose();
  }
}

class _StatCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _StatCard({required this.title, required this.value, required this.icon, this.color = Colors.blue});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, size: 40, color: color),
            const SizedBox(width: 16),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.bodySmall),
                Text(value, style: Theme.of(context).textTheme.headlineSmall),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
