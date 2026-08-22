import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/app_providers.dart';
import '../services/api_service.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final dashboard = ref.watch(mobileDashboardProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Payment Switch'),
        actions: [
          IconButton(icon: const Icon(Icons.notifications_outlined), tooltip: 'Notifications', onPressed: () => context.go('/settings')),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(mobileDashboardProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            dashboard.when(
              loading: () => const Card(child: SizedBox(height: 152, child: Center(child: CircularProgressIndicator()))),
              error: (error, _) => _HomeUnavailable(
                message: error is MobileConfigurationException
                    ? error.message
                    : 'Live account data is unavailable. The application does not show a cached or fabricated balance.',
                onRetry: () => ref.invalidate(mobileDashboardProvider),
              ),
              data: (data) => Card(
                color: theme.colorScheme.primaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Authorized Transaction Volume', style: theme.textTheme.bodyMedium),
                    const SizedBox(height: 8),
                    Text(
                      _metric(data, 'Total Volume'),
                      style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                      _QuickAction(icon: Icons.send, label: 'Send', onTap: () => context.go('/remittance')),
                      _QuickAction(icon: Icons.receipt_long, label: 'History', onTap: () => context.go('/dashboard')),
                      _QuickAction(icon: Icons.repeat, label: 'Recurring', onTap: () => context.go('/recurring')),
                      _QuickAction(icon: Icons.qr_code, label: 'QR Pay', onTap: () => context.go('/remittance')),
                    ]),
                  ]),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text('Services', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              children: [
                _ServiceCard(icon: Icons.send, label: 'Transfer', onTap: () => context.go('/remittance')),
                _ServiceCard(icon: Icons.group, label: 'Batch', onTap: () => context.go('/batch')),
                _ServiceCard(icon: Icons.warning_amber, label: 'Disputes', onTap: () => context.go('/disputes')),
                _ServiceCard(icon: Icons.shield, label: 'Compliance', onTap: () => context.go('/compliance')),
                _ServiceCard(icon: Icons.support_agent, label: 'Support', onTap: () => context.go('/support')),
                _ServiceCard(icon: Icons.card_giftcard, label: 'Referrals', onTap: () => context.go('/referrals')),
                _ServiceCard(icon: Icons.speed, label: 'Limits', onTap: () => context.go('/limits')),
                _ServiceCard(icon: Icons.attach_money, label: 'Fees', onTap: () => context.go('/fees')),
                _ServiceCard(icon: Icons.security, label: 'Security', onTap: () => context.go('/security')),
              ],
            ),
            const SizedBox(height: 24),
            Text('Recent Transactions', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            dashboard.when(
              loading: () => const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
              error: (_, __) => const Text('Recent transaction data is unavailable.'),
              data: (data) => data.recentTransactions.isEmpty
                  ? const Text('No transactions have been recorded for this account.')
                  : Column(
                      children: data.recentTransactions.take(3).map((transaction) => ListTile(
                            leading: CircleAvatar(child: Icon(_transactionIcon(transaction.status))),
                            title: Text(transaction.id),
                            subtitle: Text('${transaction.type} • ${_date(transaction.at)}'),
                            trailing: Text(
                              '${transaction.currency} ${transaction.amount}',
                              style: const TextStyle(fontWeight: FontWeight.bold),
                            ),
                          )).toList(growable: false),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  String _metric(MobileDashboard dashboard, String label) {
    for (final metric in dashboard.metrics) {
      if (metric.label == label) return metric.value;
    }
    return 'Unavailable';
  }

  static IconData _transactionIcon(String status) => status == 'completed' ? Icons.check_circle_outline : Icons.schedule;
  static String _date(DateTime value) => '${value.year}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
}

class _HomeUnavailable extends StatelessWidget {
  const _HomeUnavailable({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(children: [
            const Icon(Icons.cloud_off_outlined, size: 40),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 10),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
          ]),
        ),
      );
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Column(children: [
          CircleAvatar(child: Icon(icon, size: 20)),
          const SizedBox(height: 4),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ]),
      );
}

class _ServiceCard extends StatelessWidget {
  const _ServiceCard({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, size: 28, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 8),
            Text(label, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
          ]),
        ),
      );
}
