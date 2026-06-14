import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

/// Shared API service instance.
final apiServiceProvider = Provider<ApiService>((ref) => ApiService());

/// Auth state — tracks current user session.
class AuthState {
  final bool isAuthenticated;
  final String? userId;
  final String? email;
  final String? role;
  final String? token;

  const AuthState({
    this.isAuthenticated = false,
    this.userId,
    this.email,
    this.role,
    this.token,
  });

  AuthState copyWith({bool? isAuthenticated, String? userId, String? email, String? role, String? token}) {
    return AuthState(
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
      userId: userId ?? this.userId,
      email: email ?? this.email,
      role: role ?? this.role,
      token: token ?? this.token,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState());

  void login({required String userId, required String email, String? role, String? token}) {
    state = AuthState(isAuthenticated: true, userId: userId, email: email, role: role, token: token);
  }

  void logout() {
    state = const AuthState();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier());

/// Notifications state — unread count badge for bottom nav.
class NotificationState {
  final int unreadCount;
  final List<Map<String, dynamic>> recent;

  const NotificationState({this.unreadCount = 0, this.recent = const []});
}

class NotificationNotifier extends StateNotifier<NotificationState> {
  NotificationNotifier() : super(const NotificationState());

  void setUnreadCount(int count) {
    state = NotificationState(unreadCount: count, recent: state.recent);
  }

  void addNotification(Map<String, dynamic> notification) {
    state = NotificationState(
      unreadCount: state.unreadCount + 1,
      recent: [notification, ...state.recent].take(50).toList(),
    );
  }

  void markAllRead() {
    state = NotificationState(unreadCount: 0, recent: state.recent);
  }
}

final notificationProvider = StateNotifierProvider<NotificationNotifier, NotificationState>(
  (ref) => NotificationNotifier(),
);

/// User preferences (persisted via Hive).
class UserPreferences {
  final bool pushNotifications;
  final bool emailNotifications;
  final bool smsAlerts;
  final bool biometricLogin;
  final bool twoFactor;
  final String currency;
  final String language;

  const UserPreferences({
    this.pushNotifications = true,
    this.emailNotifications = true,
    this.smsAlerts = false,
    this.biometricLogin = false,
    this.twoFactor = false,
    this.currency = 'NGN',
    this.language = 'English',
  });

  UserPreferences copyWith({
    bool? pushNotifications,
    bool? emailNotifications,
    bool? smsAlerts,
    bool? biometricLogin,
    bool? twoFactor,
    String? currency,
    String? language,
  }) {
    return UserPreferences(
      pushNotifications: pushNotifications ?? this.pushNotifications,
      emailNotifications: emailNotifications ?? this.emailNotifications,
      smsAlerts: smsAlerts ?? this.smsAlerts,
      biometricLogin: biometricLogin ?? this.biometricLogin,
      twoFactor: twoFactor ?? this.twoFactor,
      currency: currency ?? this.currency,
      language: language ?? this.language,
    );
  }
}

class PreferencesNotifier extends StateNotifier<UserPreferences> {
  PreferencesNotifier() : super(const UserPreferences());

  void update(UserPreferences prefs) => state = prefs;
  void togglePush() => state = state.copyWith(pushNotifications: !state.pushNotifications);
  void toggleEmail() => state = state.copyWith(emailNotifications: !state.emailNotifications);
  void toggleSms() => state = state.copyWith(smsAlerts: !state.smsAlerts);
  void toggleBiometric() => state = state.copyWith(biometricLogin: !state.biometricLogin);
  void toggleTwoFactor() => state = state.copyWith(twoFactor: !state.twoFactor);
  void setCurrency(String c) => state = state.copyWith(currency: c);
  void setLanguage(String l) => state = state.copyWith(language: l);
}

final preferencesProvider = StateNotifierProvider<PreferencesNotifier, UserPreferences>(
  (ref) => PreferencesNotifier(),
);
