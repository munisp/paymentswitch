import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_providers.dart';
import '../services/api_service.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(mobileDashboardProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            tooltip: 'Refresh dashboard',
            onPressed: () => ref.invalidate(mobileDashboardProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: dashboard.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _UnavailableState(
          message: _dashboardError(error),
          onRetry: () => ref.invalidate(mobileDashboardProvider),
        ),
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.refresh(mobileDashboardProvider.future),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (data.metrics.isEmpty)
                const _EmptyState(message: 'No authorized transaction data is available for this account.')
              else
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: data.metrics.length,
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    childAspectRatio: 1.45,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                  ),
                  itemBuilder: (_, index) => _MetricCard(metric: data.metrics[index]),
                ),
              const SizedBox(height: 24),
              Text('Recent Transactions', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              if (data.recentTransactions.isEmpty)
                const _EmptyState(message: 'No transactions have been recorded for this account.')
              else
                ...data.recentTransactions.map((transaction) => ListTile(
                      leading: CircleAvatar(
                        child: Icon(_statusIcon(transaction.status)),
                      ),
                      title: Text(transaction.id),
                      subtitle: Text('${transaction.type} • ${_formatTime(transaction.at)}'),
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            '${transaction.currency} ${transaction.amount}',
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          Text(transaction.status, style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                    )),
            ],
          ),
        ),
      ),
    );
  }

  String _dashboardError(Object error) => error is MobileConfigurationException
      ? error.message
      : 'Live dashboard data is unavailable. No local values are displayed while the service cannot be reached.';

  static IconData _statusIcon(String status) => switch (status) {
        'completed' => Icons.check_circle_outline,
        'failed' => Icons.error_outline,
        'reversed' => Icons.undo,
        _ => Icons.schedule,
      };

  static String _formatTime(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.metric});
  final MobileMetric metric;

  @override
  Widget build(BuildContext context) {
    final color = metric.positive == true
        ? Colors.green
        : metric.positive == false
            ? Colors.red
            : Theme.of(context).colorScheme.primary;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(metric.label, style: Theme.of(context).textTheme.bodySmall),
            Text(metric.value, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold, color: color)),
            Text(metric.change, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _UnavailableState extends StatelessWidget {
  const _UnavailableState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 48),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
            ],
          ),
        ),
      );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
      );
}
