import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'providers/app_providers.dart';
import 'screens/home_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/remittance_screen.dart';
import 'screens/disputes_screen.dart';
import 'screens/recurring_screen.dart';
import 'screens/batch_transfer_screen.dart';
import 'screens/support_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/compliance_screen.dart';
import 'screens/security_screen.dart';
import 'screens/referral_screen.dart';
import 'screens/limits_screen.dart';
import 'screens/fees_screen.dart';
import 'screens/audit_log_screen.dart';
import 'screens/login_screen.dart';
import 'screens/outbound_remittance_screen.dart';

final GoRouter _router = GoRouter(
  initialLocation: '/login',
  routes: [
    GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
    ShellRoute(
      builder: (_, __, child) => MainShell(child: child),
      routes: [
        GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
        GoRoute(path: '/dashboard', builder: (_, __) => const DashboardScreen()),
        GoRoute(path: '/remittance', builder: (_, __) => const RemittanceScreen()),
        GoRoute(path: '/disputes', builder: (_, __) => const DisputesScreen()),
        GoRoute(path: '/recurring', builder: (_, __) => const RecurringScreen()),
        GoRoute(path: '/batch', builder: (_, __) => const BatchTransferScreen()),
        GoRoute(path: '/support', builder: (_, __) => const SupportScreen()),
        GoRoute(path: '/compliance', builder: (_, __) => const ComplianceScreen()),
        GoRoute(path: '/security', builder: (_, __) => const SecurityScreen()),
        GoRoute(path: '/referrals', builder: (_, __) => const ReferralScreen()),
        GoRoute(path: '/limits', builder: (_, __) => const LimitsScreen()),
        GoRoute(path: '/fees', builder: (_, __) => const FeesScreen()),
        GoRoute(path: '/audit-log', builder: (_, __) => const AuditLogScreen()),
        GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
        GoRoute(path: '/outbound', builder: (_, __) => const OutboundRemittanceScreen()),
      ],
    ),
  ],
);

// Theme notifier for dark mode toggle
class ThemeNotifier extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.system;
  ThemeMode get mode => _mode;

  void toggle() {
    _mode = _mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
  }
}

final themeNotifier = ThemeNotifier();

class PaymentSwitchApp extends StatelessWidget {
  const PaymentSwitchApp({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: themeNotifier,
      builder: (context, _) => MaterialApp.router(
        title: 'Payment Switch',
        debugShowCheckedModeBanner: false,
        themeMode: themeNotifier.mode,
        theme: ThemeData(
          colorSchemeSeed: const Color(0xFF1A73E8),
          useMaterial3: true,
          brightness: Brightness.light,
          pageTransitionsTheme: const PageTransitionsTheme(
            builders: {
              TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
              TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
            },
          ),
        ),
        darkTheme: ThemeData(
          colorSchemeSeed: const Color(0xFF1A73E8),
          useMaterial3: true,
          brightness: Brightness.dark,
          pageTransitionsTheme: const PageTransitionsTheme(
            builders: {
              TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
              TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
            },
          ),
        ),
        routerConfig: _router,
      ),
    );
  }
}

class MainShell extends ConsumerWidget {
  final Widget child;
  const MainShell({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    if (auth.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!auth.isAuthenticated) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) context.go('/login');
      });
      return const SizedBox.shrink();
    }
    final isTablet = MediaQuery.of(context).size.shortestSide >= 600;

    return Scaffold(
      body: child,
      // Floating Action Button (#32)
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showQuickActions(context),
        child: const Icon(Icons.add),
      ),
      // Bottom Navigation (#25) - adaptive for tablet
      bottomNavigationBar: NavigationBar(
        selectedIndex: _getSelectedIndex(GoRouterState.of(context).uri.toString()),
        onDestinationSelected: (index) => _onItemTapped(context, index),
        labelBehavior: isTablet
            ? NavigationDestinationLabelBehavior.alwaysShow
            : NavigationDestinationLabelBehavior.onlyShowSelected,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
          NavigationDestination(icon: Icon(Icons.send_outlined), selectedIcon: Icon(Icons.send), label: 'Send'),
          NavigationDestination(icon: Icon(Icons.account_balance_outlined), selectedIcon: Icon(Icons.account_balance), label: 'Settlement'),
          NavigationDestination(icon: Icon(Icons.more_horiz), selectedIcon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    );
  }

  // Quick actions bottom sheet (#32)
  void _showQuickActions(BuildContext context) {
    HapticFeedback.mediumImpact(); // Haptic feedback (#28)
    showModalBottomSheet(
      context: context,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Quick Actions', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.send, color: Colors.blue),
              title: const Text('New Transfer'),
              onTap: () { Navigator.pop(ctx); context.go('/remittance'); },
            ),
            ListTile(
              leading: const Icon(Icons.account_balance_wallet, color: Colors.green),
              title: const Text('Check Balance'),
              onTap: () { Navigator.pop(ctx); context.go('/dashboard'); },
            ),
            ListTile(
              leading: const Icon(Icons.repeat, color: Colors.orange),
              title: const Text('Recurring Transfer'),
              onTap: () { Navigator.pop(ctx); context.go('/recurring'); },
            ),
            ListTile(
              leading: const Icon(Icons.batch_prediction, color: Colors.purple),
              title: const Text('Batch Transfer'),
              onTap: () { Navigator.pop(ctx); context.go('/batch'); },
            ),
          ],
        ),
      ),
    );
  }

  int _getSelectedIndex(String location) {
    if (location.startsWith('/dashboard')) return 1;
    if (location.startsWith('/remittance')) return 2;
    if (location.startsWith('/outbound')) return 3;
    if (location.startsWith('/settings') || location.startsWith('/support')) return 4;
    return 0;
  }

  void _onItemTapped(BuildContext context, int index) {
    HapticFeedback.selectionClick(); // Haptic feedback (#28)
    switch (index) {
      case 0: context.go('/'); break;
      case 1: context.go('/dashboard'); break;
      case 2: context.go('/remittance'); break;
      case 3: context.go('/outbound'); break;
      case 4: _showMoreSheet(context); break;
    }
  }

  // More menu bottom sheet — grouped by category
  void _showMoreSheet(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.85,
        expand: false,
        builder: (_, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.symmetric(vertical: 12),
          children: [
            // Drag handle
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: colorScheme.onSurface.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            // Operations
            _sectionHeader(context, 'Operations', Icons.swap_horiz),
            ListTile(leading: const Icon(Icons.gavel), title: const Text('Disputes'), onTap: () { Navigator.pop(ctx); context.go('/disputes'); }),
            ListTile(leading: const Icon(Icons.receipt_long), title: const Text('Fees & Pricing'), onTap: () { Navigator.pop(ctx); context.go('/fees'); }),
            ListTile(leading: const Icon(Icons.speed), title: const Text('Transaction Limits'), onTap: () { Navigator.pop(ctx); context.go('/limits'); }),
            const Divider(height: 1, indent: 16, endIndent: 16),
            // Compliance & Security
            _sectionHeader(context, 'Compliance & Security', Icons.shield_outlined),
            ListTile(leading: const Icon(Icons.verified_user), title: const Text('Compliance'), onTap: () { Navigator.pop(ctx); context.go('/compliance'); }),
            ListTile(leading: const Icon(Icons.security), title: const Text('Security'), onTap: () { Navigator.pop(ctx); context.go('/security'); }),
            ListTile(leading: const Icon(Icons.history), title: const Text('Audit Log'), onTap: () { Navigator.pop(ctx); context.go('/audit-log'); }),
            const Divider(height: 1, indent: 16, endIndent: 16),
            // Account
            _sectionHeader(context, 'Account', Icons.person_outline),
            ListTile(leading: const Icon(Icons.people), title: const Text('Referrals'), onTap: () { Navigator.pop(ctx); context.go('/referrals'); }),
            ListTile(leading: const Icon(Icons.support_agent), title: const Text('Support'), onTap: () { Navigator.pop(ctx); context.go('/support'); }),
            const Divider(height: 1, indent: 16, endIndent: 16),
            // Preferences
            _sectionHeader(context, 'Preferences', Icons.tune),
            ListTile(
              leading: Icon(themeNotifier.mode == ThemeMode.dark ? Icons.light_mode : Icons.dark_mode),
              title: Text(themeNotifier.mode == ThemeMode.dark ? 'Light Mode' : 'Dark Mode'),
              onTap: () { Navigator.pop(ctx); themeNotifier.toggle(); },
            ),
            ListTile(leading: const Icon(Icons.settings), title: const Text('Settings'), onTap: () { Navigator.pop(ctx); context.go('/settings'); }),
          ],
        ),
      ),
    );
  }

  Widget _sectionHeader(BuildContext context, String title, IconData icon) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: [
          Icon(icon, size: 16, color: colorScheme.primary),
          const SizedBox(width: 8),
          Text(
            title.toUpperCase(),
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
              color: colorScheme.primary,
            ),
          ),
        ],
      ),
    );
  }
}
