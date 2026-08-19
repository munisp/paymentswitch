import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_providers.dart';

/// Outbound remittance operations are displayed only from the protected server
/// read model. Detailed operational actions remain in the web operations portal
/// until an equivalent mobile command API is exposed and authorized.
class OutboundRemittanceScreen extends ConsumerWidget {
  const OutboundRemittanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(outboundDashboardProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Outbound Operations'),
        actions: [
          IconButton(
            tooltip: 'Refresh operations',
            onPressed: () => ref.invalidate(outboundDashboardProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: dashboard.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => _Unavailable(
          onRetry: () => ref.invalidate(outboundDashboardProvider),
          message: 'Live outbound-remittance data is unavailable. No provider health, prefund, FX, transfer, or settlement values are displayed without the authoritative service.',
        ),
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.refresh(outboundDashboardProvider.future),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Participant Operations', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(
                data['isAdmin'] == true
                    ? 'Authorized operations-wide PostgreSQL read model'
                    : 'Authorized participant-scoped PostgreSQL read model',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              _MetricsGrid(data: data),
              const SizedBox(height: 24),
              Text('Recent Transfers', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              _RecentTransfers(transfers: data['recentTransfers']),
              const SizedBox(height: 24),
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'Detailed actions for prefund, corridors, FX locks, payment rails, compliance, and settlement are not represented by local controls in the mobile app. Use the secured operations portal until authoritative mobile command routes and approval workflows are deployed.',
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MetricsGrid extends StatelessWidget {
  const _MetricsGrid({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final metrics = <(String, String, IconData)>[
      ('Transfers', _value('totalTransfers'), Icons.swap_horiz),
      ('Volume', _value('totalVolume'), Icons.payments_outlined),
      ('Success Rate', '${_value('successRate')}%', Icons.check_circle_outline),
      ('Prefund Balance', _value('totalPrefundBalance'), Icons.account_balance_wallet_outlined),
      ('Active Corridors', _value('activeCorridors'), Icons.route_outlined),
      ('Compliance Escalations', _value('escalatedCompliance'), Icons.policy_outlined),
    ];
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: metrics.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 1.45,
      ),
      itemBuilder: (_, index) {
        final metric = metrics[index];
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(metric.$3),
              const Spacer(),
              Text(metric.$1, style: Theme.of(context).textTheme.bodySmall),
              Text(metric.$2, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            ]),
          ),
        );
      },
    );
  }

  String _value(String key) => data[key]?.toString() ?? 'Unavailable';
}

class _RecentTransfers extends StatelessWidget {
  const _RecentTransfers({required this.transfers});
  final Object? transfers;

  @override
  Widget build(BuildContext context) {
    if (transfers is! List || transfers.isEmpty) {
      return const Text('No recent outbound transfers are available for this scope.');
    }
    return Column(
      children: transfers.whereType<Map>().map((raw) {
        final transfer = Map<String, dynamic>.from(raw);
        return ListTile(
          leading: const CircleAvatar(child: Icon(Icons.swap_horiz)),
          title: Text(transfer['transferRef']?.toString() ?? 'Transfer reference unavailable'),
          subtitle: Text('${transfer['corridor'] ?? 'Corridor unavailable'} • ${transfer['status'] ?? 'Status unavailable'}'),
          trailing: Text(transfer['amountNgn']?.toString() ?? 'Amount unavailable'),
        );
      }).toList(growable: false),
    );
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined, size: 48),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
          ]),
        ),
      );
}
