import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/api_service.dart';

/// Shared API client. Runtime endpoints and OIDC values are supplied as Dart
/// build-time definitions; no production URL or client secret is hard-coded.
final apiServiceProvider = Provider<ApiService>((ref) => ApiService());

class AuthState {
  const AuthState({
    this.isAuthenticated = false,
    this.isLoading = true,
    this.userId,
    this.email,
    this.role,
    this.token,
    this.error,
  });

  final bool isAuthenticated;
  final bool isLoading;
  final String? userId;
  final String? email;
  final String? role;
  /// Short-lived access token. This state is process-memory only.
  final String? token;
  final String? error;

  AuthState copyWith({
    bool? isAuthenticated,
    bool? isLoading,
    String? userId,
    String? email,
    String? role,
    String? token,
    String? error,
    bool clearError = false,
  }) => AuthState(
        isAuthenticated: isAuthenticated ?? this.isAuthenticated,
        isLoading: isLoading ?? this.isLoading,
        userId: userId ?? this.userId,
        email: email ?? this.email,
        role: role ?? this.role,
        token: token ?? this.token,
        error: clearError ? null : (error ?? this.error),
      );
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._api) : super(const AuthState()) {
    _bootstrap();
  }

  final ApiService _api;

  Future<void> _bootstrap() async {
    try {
      final session = await _api.restoreSession();
      if (session == null) {
        state = const AuthState(isLoading: false);
        return;
      }
      _apply(session);
    } catch (error) {
      state = AuthState(isLoading: false, error: _message(error));
    }
  }

  Future<void> signIn() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      _apply(await _api.signIn());
    } catch (error) {
      state = AuthState(isLoading: false, error: _message(error));
    }
  }

  Future<void> logout() async {
    await _api.signOut();
    state = const AuthState(isLoading: false);
  }

  void _apply(MobileSession session) {
    state = AuthState(
      isAuthenticated: true,
      isLoading: false,
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
      token: session.accessToken,
    );
  }

  String _message(Object error) => error is MobileConfigurationException || error is MobileAuthenticationException
      ? error.toString()
      : 'Unable to establish a secure session. Verify the identity service and try again.';
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>(
  (ref) => AuthNotifier(ref.watch(apiServiceProvider)),
);

/// PostgreSQL-backed mobile dashboard response. A request failure is surfaced to
/// the UI as unavailable; no local dashboard fallback is produced.
final mobileDashboardProvider = FutureProvider<MobileDashboard>((ref) async {
  final auth = ref.watch(authProvider);
  if (!auth.isAuthenticated) {
    throw MobileAuthenticationException('A secure mobile session is required before loading dashboard data.');
  }
  return ref.watch(apiServiceProvider).getDashboard();
});

final outboundDashboardProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final auth = ref.watch(authProvider);
  if (!auth.isAuthenticated) {
    throw MobileAuthenticationException('A secure mobile session is required before loading outbound operations.');
  }
  return ref.watch(apiServiceProvider).getOutboundDashboardMetrics();
});

/// Notifications state — unread count badge for the mobile shell. Backend
/// synchronization is intentionally not fabricated when the API is unavailable.
class NotificationState {
  const NotificationState({this.unreadCount = 0, this.recent = const []});
  final int unreadCount;
  final List<Map<String, dynamic>> recent;
}

class NotificationNotifier extends StateNotifier<NotificationState> {
  NotificationNotifier() : super(const NotificationState());

  void setUnreadCount(int count) => state = NotificationState(unreadCount: count, recent: state.recent);
  void addNotification(Map<String, dynamic> notification) => state = NotificationState(
        unreadCount: state.unreadCount + 1,
        recent: [notification, ...state.recent].take(50).toList(growable: false),
      );
  void markAllRead() => state = NotificationState(unreadCount: 0, recent: state.recent);
}

final notificationProvider = StateNotifierProvider<NotificationNotifier, NotificationState>(
  (ref) => NotificationNotifier(),
);

class UserPreferences {
  const UserPreferences({
    this.pushNotifications = true,
    this.emailNotifications = true,
    this.smsAlerts = false,
    this.biometricLogin = false,
    this.twoFactor = false,
    this.currency = 'NGN',
    this.language = 'English',
  });

  final bool pushNotifications;
  final bool emailNotifications;
  final bool smsAlerts;
  final bool biometricLogin;
  final bool twoFactor;
  final String currency;
  final String language;

  UserPreferences copyWith({
    bool? pushNotifications,
    bool? emailNotifications,
    bool? smsAlerts,
    bool? biometricLogin,
    bool? twoFactor,
    String? currency,
    String? language,
  }) => UserPreferences(
        pushNotifications: pushNotifications ?? this.pushNotifications,
        emailNotifications: emailNotifications ?? this.emailNotifications,
        smsAlerts: smsAlerts ?? this.smsAlerts,
        biometricLogin: biometricLogin ?? this.biometricLogin,
        twoFactor: twoFactor ?? this.twoFactor,
        currency: currency ?? this.currency,
        language: language ?? this.language,
      );
}

class PreferencesNotifier extends StateNotifier<UserPreferences> {
  PreferencesNotifier() : super(const UserPreferences());
  void update(UserPreferences prefs) => state = prefs;
  void togglePush() => state = state.copyWith(pushNotifications: !state.pushNotifications);
  void toggleEmail() => state = state.copyWith(emailNotifications: !state.emailNotifications);
  void toggleSms() => state = state.copyWith(smsAlerts: !state.smsAlerts);
  void toggleBiometric() => state = state.copyWith(biometricLogin: !state.biometricLogin);
  void toggleTwoFactor() => state = state.copyWith(twoFactor: !state.twoFactor);
  void setCurrency(String currency) => state = state.copyWith(currency: currency);
  void setLanguage(String language) => state = state.copyWith(language: language);
}

final preferencesProvider = StateNotifierProvider<PreferencesNotifier, UserPreferences>(
  (ref) => PreferencesNotifier(),
);
