import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MobileConfigurationException implements Exception {
  MobileConfigurationException(this.message);
  final String message;

  @override
  String toString() => message;
}

class MobileAuthenticationException implements Exception {
  MobileAuthenticationException(this.message);
  final String message;

  @override
  String toString() => message;
}

class MobileUser {
  const MobileUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
  });

  final String id;
  final String email;
  final String name;
  final String role;

  factory MobileUser.fromJson(Map<String, dynamic> value) {
    final rawRoles = value['roles'];
    final roles = rawRoles is List
        ? rawRoles.whereType<String>().toList(growable: false)
        : const <String>[];
    return MobileUser(
      id: _string(value['id'] ?? value['sub']),
      email: _string(value['email']),
      name: _string(value['name'] ?? value['username'] ?? value['email']),
      role: roles.contains('admin') ? 'admin' : (roles.isEmpty ? 'participant' : roles.first),
    );
  }
}

class MobileSession {
  const MobileSession({
    required this.accessToken,
    required this.expiresAt,
    required this.user,
  });

  final String accessToken;
  final DateTime expiresAt;
  final MobileUser user;
}

class MobileMetric {
  const MobileMetric({
    required this.label,
    required this.value,
    required this.change,
    required this.positive,
  });

  final String label;
  final String value;
  final String change;
  final bool? positive;

  factory MobileMetric.fromJson(Map<String, dynamic> value) => MobileMetric(
        label: _string(value['label']),
        value: _string(value['value']),
        change: _string(value['change']),
        positive: value['positive'] is bool ? value['positive'] as bool : null,
      );
}

class MobileTransaction {
  const MobileTransaction({
    required this.id,
    required this.type,
    required this.amount,
    required this.currency,
    required this.status,
    required this.at,
  });

  final String id;
  final String type;
  final String amount;
  final String currency;
  final String status;
  final DateTime at;

  factory MobileTransaction.fromJson(Map<String, dynamic> value) {
    final rawTime = value['time'] ?? value['date'];
    final parsed = rawTime is String ? DateTime.tryParse(rawTime) : null;
    if (parsed == null) {
      throw const FormatException('Mobile transaction response did not include a valid timestamp.');
    }
    return MobileTransaction(
      id: _string(value['id']),
      type: _string(value['type']),
      amount: _string(value['amount']),
      currency: _string(value['currency']),
      status: _string(value['status']),
      at: parsed.toLocal(),
    );
  }
}

class MobileDashboard {
  const MobileDashboard({required this.metrics, required this.recentTransactions});

  final List<MobileMetric> metrics;
  final List<MobileTransaction> recentTransactions;

  factory MobileDashboard.fromJson(Map<String, dynamic> value) {
    if (value['source'] != 'postgresql') {
      throw const FormatException('Mobile dashboard response is not an authoritative PostgreSQL read model.');
    }
    final metrics = (value['metrics'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map((item) => MobileMetric.fromJson(Map<String, dynamic>.from(item)))
        .toList(growable: false);
    final transactions = (value['recentTransactions'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map((item) => MobileTransaction.fromJson(Map<String, dynamic>.from(item)))
        .toList(growable: false);
    return MobileDashboard(metrics: metrics, recentTransactions: transactions);
  }
}

String _string(Object? value) => value is String ? value : value?.toString() ?? '';

/// Configured only through build-time values. No production endpoint, client
/// secret, or fallback development host is embedded in the application binary.
class MobileRuntimeConfig {
  const MobileRuntimeConfig({
    required this.apiBaseUrl,
    required this.issuer,
    required this.clientId,
    required this.redirectUri,
  });

  static const environmentApiBaseUrl = String.fromEnvironment('PAYMENT_SWITCH_API_BASE_URL');
  static const environmentIssuer = String.fromEnvironment('PAYMENT_SWITCH_OIDC_ISSUER');
  static const environmentClientId = String.fromEnvironment('PAYMENT_SWITCH_OIDC_CLIENT_ID');
  static const environmentRedirectUri = String.fromEnvironment('PAYMENT_SWITCH_OIDC_REDIRECT_URI');

  factory MobileRuntimeConfig.fromEnvironment() {
    final config = MobileRuntimeConfig(
      apiBaseUrl: MobileRuntimeConfig.environmentApiBaseUrl,
      issuer: MobileRuntimeConfig.environmentIssuer,
      clientId: MobileRuntimeConfig.environmentClientId,
      redirectUri: MobileRuntimeConfig.environmentRedirectUri,
    );
    config.validate();
    return config;
  }

  final String apiBaseUrl;
  final String issuer;
  final String clientId;
  final String redirectUri;

  void validate() {
    final missing = <String>[];
    if (apiBaseUrl.isEmpty) missing.add('PAYMENT_SWITCH_API_BASE_URL');
    if (issuer.isEmpty) missing.add('PAYMENT_SWITCH_OIDC_ISSUER');
    if (clientId.isEmpty) missing.add('PAYMENT_SWITCH_OIDC_CLIENT_ID');
    if (redirectUri.isEmpty) missing.add('PAYMENT_SWITCH_OIDC_REDIRECT_URI');
    if (missing.isNotEmpty) {
      throw MobileConfigurationException(
        'Mobile identity is not configured. Missing build-time values: ${missing.join(', ')}.',
      );
    }
    if (!Uri.parse(apiBaseUrl).hasScheme || !Uri.parse(issuer).hasScheme || !Uri.parse(redirectUri).hasScheme) {
      throw MobileConfigurationException('Mobile API, issuer, and redirect values must be absolute URIs.');
    }
  }
}

/// Authorization Code + PKCE client. Access tokens are held only in this
/// process. The Keycloak refresh token is retained only in platform secure
/// storage and is never placed in Hive or an application preference store.
class ApiService {
  ApiService({
    MobileRuntimeConfig? config,
    Dio? dio,
    FlutterAppAuth? appAuth,
    FlutterSecureStorage? storage,
  })  : _providedConfig = config,
        _appAuth = appAuth ?? const FlutterAppAuth(),
        _storage = storage ?? const FlutterSecureStorage(),
        _dio = dio ?? Dio();

  static const _refreshTokenKey = 'ps_mobile_refresh_token';

  final MobileRuntimeConfig? _providedConfig;
  MobileRuntimeConfig get _config => _providedConfig ?? MobileRuntimeConfig.fromEnvironment();
  final FlutterAppAuth _appAuth;
  final FlutterSecureStorage _storage;
  final Dio _dio;
  String? _accessToken;
  DateTime? _accessTokenExpiry;

  void initialize() {
    _dio.options = BaseOptions(
      baseUrl: _config.apiBaseUrl,
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 30),
      headers: const {'Content-Type': 'application/json', 'Accept': 'application/json'},
    );
    _dio.interceptors.clear();
    _dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      final token = _accessToken;
      if (token == null || token.isEmpty) {
        return handler.reject(
          DioException(
            requestOptions: options,
            type: DioExceptionType.unknown,
            error: MobileAuthenticationException('A live Keycloak access token is required for mobile API requests.'),
          ),
        );
      }
      options.headers['Authorization'] = 'Bearer $token';
      handler.next(options);
    }));
  }

  Future<MobileSession> signIn() async {
    initialize();
    final response = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        _config.clientId,
        _config.redirectUri,
        issuer: _config.issuer,
        scopes: const <String>['openid', 'profile', 'email', 'offline_access'],
        promptValues: const <String>['login'],
      ),
    );
    if (response == null || response.accessToken == null || response.accessToken!.isEmpty) {
      throw MobileAuthenticationException('Keycloak did not return an access token.');
    }
    if (response.refreshToken == null || response.refreshToken!.isEmpty) {
      throw MobileAuthenticationException('Keycloak did not return a refresh token; offline_access must be enabled for the mobile client.');
    }
    await _storage.write(key: _refreshTokenKey, value: response.refreshToken);
    return _activateAccessToken(response.accessToken!, response.accessTokenExpirationDateTime);
  }

  Future<MobileSession?> restoreSession() async {
    final refreshToken = await _storage.read(key: _refreshTokenKey);
    if (refreshToken == null || refreshToken.isEmpty) return null;
    try {
      initialize();
      final response = await _appAuth.token(TokenRequest(
        _config.clientId,
        _config.redirectUri,
        issuer: _config.issuer,
        refreshToken: refreshToken,
        scopes: const <String>['openid', 'profile', 'email', 'offline_access'],
      ));
      if (response == null || response.accessToken == null || response.accessToken!.isEmpty) {
        throw MobileAuthenticationException('Keycloak did not return a refreshed access token.');
      }
      if (response.refreshToken != null && response.refreshToken!.isNotEmpty) {
        await _storage.write(key: _refreshTokenKey, value: response.refreshToken);
      }
      return _activateAccessToken(response.accessToken!, response.accessTokenExpirationDateTime);
    } catch (_) {
      await signOut();
      return null;
    }
  }

  Future<void> signOut() async {
    _accessToken = null;
    _accessTokenExpiry = null;
    await _storage.delete(key: _refreshTokenKey);
  }

  Future<MobileSession> _activateAccessToken(String accessToken, DateTime? expiresAt) async {
    _accessToken = accessToken;
    _accessTokenExpiry = expiresAt;
    try {
      final user = await currentUser();
      if (user.id.isEmpty) {
        throw MobileAuthenticationException('The authenticated user response did not include an identifier.');
      }
      return MobileSession(
        accessToken: accessToken,
        expiresAt: expiresAt ?? DateTime.now().add(const Duration(minutes: 5)),
        user: user,
      );
    } catch (_) {
      await signOut();
      rethrow;
    }
  }

  Future<MobileUser> currentUser() async {
    final result = await _query('auth.me');
    if (result is! Map) {
      throw const FormatException('auth.me did not return an authenticated user object.');
    }
    return MobileUser.fromJson(Map<String, dynamic>.from(result));
  }

  Future<MobileDashboard> getDashboard() async {
    final result = await _query('dashboard.getStats');
    if (result is! Map) throw const FormatException('dashboard.getStats did not return an object.');
    return MobileDashboard.fromJson(Map<String, dynamic>.from(result));
  }

  Future<Map<String, dynamic>> getOutboundDashboardMetrics() async {
    final result = await _query('outboundRemittance.getDashboardMetrics');
    if (result is! Map) throw const FormatException('outboundRemittance.getDashboardMetrics did not return an object.');
    return Map<String, dynamic>.from(result);
  }

  Future<List<MobileTransaction>> getTransactions({int limit = 50}) async {
    final result = await _query('transactions.list', <String, dynamic>{'limit': limit});
    if (result is! List) throw const FormatException('transactions.list did not return an array.');
    return result
        .whereType<Map>()
        .map((item) => MobileTransaction.fromJson(Map<String, dynamic>.from(item)))
        .toList(growable: false);
  }

  Future<dynamic> _query(String procedure, [Map<String, dynamic>? input]) async {
    final query = input == null ? null : <String, dynamic>{'input': jsonEncode(<String, dynamic>{'json': input})};
    final response = await _dio.get('/api/trpc/$procedure', queryParameters: query);
    return _unwrapTrpc(response.data);
  }

  Future<dynamic> _mutation(String procedure, [Map<String, dynamic>? input]) async {
    final response = await _dio.post('/api/trpc/$procedure', data: <String, dynamic>{'json': input ?? const <String, dynamic>{}});
    return _unwrapTrpc(response.data);
  }

  dynamic _unwrapTrpc(dynamic body) {
    if (body is! Map) return body;
    final result = body['result'];
    if (result is Map) {
      final data = result['data'];
      if (data is Map && data.containsKey('json')) return data['json'];
      return data;
    }
    return body;
  }

  // Registered operational namespaces retained for their corresponding mobile screens.
  Future<dynamic> getRemittances({int page = 1, int limit = 20}) => _query('remittance.list', {'page': page, 'limit': limit});
  Future<dynamic> createRemittance(Map<String, dynamic> data) => _mutation('remittance.create', data);
  Future<dynamic> getDisputes({int page = 1}) => _query('disputes.list', {'page': page});
  Future<dynamic> createDispute(Map<String, dynamic> data) => _mutation('disputes.create', data);
  Future<dynamic> getRecurringRemittances() => _query('recurringRemittances.list');
  Future<dynamic> createRecurringRemittance(Map<String, dynamic> data) => _mutation('recurringRemittances.create', data);
  Future<dynamic> getBatchTransfers() => _query('batchTransfers.list');
  Future<dynamic> createBatchTransfer(Map<String, dynamic> data) => _mutation('batchTransfers.create', data);
  Future<dynamic> getSupportTickets() => _query('supportTickets.list');
  Future<dynamic> createSupportTicket(Map<String, dynamic> data) => _mutation('supportTickets.create', data);
  Future<dynamic> sendSupportMessage(Map<String, dynamic> data) => _mutation('supportTickets.sendMessage', data);
  Future<dynamic> getComplianceReports() => _query('complianceReports.list');
  Future<dynamic> getSecurityScore() => _query('security.getSecurityScore');
  Future<dynamic> getSecurityEvents() => _query('security.listEvents');
  Future<dynamic> getMyReferralCode() => _query('referrals.getMyCode');
  Future<dynamic> getMyReferrals() => _query('referrals.myReferrals');
  Future<dynamic> getMyLimits() => _query('transactionLimits.getMyLimits');
  Future<dynamic> getFeeConfigurations() => _query('feeManagement.list');
  Future<dynamic> calculateFee(Map<String, dynamic> data) => _query('feeManagement.calculateFee', data);
  Future<dynamic> getAuditLogs({int page = 1, int limit = 50}) => _query('auditLog.list', {'page': page, 'limit': limit});
  Future<dynamic> getPreferences() => _query('userPreferences.get');
  Future<dynamic> updatePreferences(Map<String, dynamic> data) => _mutation('userPreferences.update', data);
  Future<dynamic> getNotificationPreferences() => _query('notificationPreferences.getPreferences');
  Future<dynamic> updateNotificationPreferences(Map<String, dynamic> data) => _mutation('notificationPreferences.updatePreferences', data);
  Future<dynamic> getMaintenanceStatus() => _query('maintenance.getStatus');
  Future<dynamic> getQueueStatus() => _query('resilience.getQueueStatus');
  Future<dynamic> healthCheck() => _query('resilience.healthCheck');
  Future<dynamic> getAccountActivity({int page = 1, int limit = 50}) => _query('accountActivity.list', {'page': page, 'limit': limit});
  Future<dynamic> getRateAlerts() => _query('rateAlerts.list');
  Future<dynamic> createRateAlert(Map<String, dynamic> data) => _mutation('rateAlerts.create', data);
  Future<dynamic> getInboundRemittances({int page = 1}) => _query('inboundRemittance.list', {'page': page});
  Future<dynamic> getSettlements({int page = 1}) => _query('settlements.list', {'page': page});
  Future<dynamic> setupTwoFactor() => _mutation('twoFactor.setup');
  Future<dynamic> enableTwoFactor(String token) => _mutation('twoFactor.enable', {'token': token});
  Future<dynamic> verifyTwoFactor(String token, {bool useBackupCode = false}) => _mutation('twoFactor.verify', {'token': token, 'useBackupCode': useBackupCode});
}
