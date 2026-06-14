import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hive/hive.dart';

class ApiService {
  static const String baseUrl = 'https://api.payswitch.ng';
  late final Dio _dio;
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  final Box _offlineQueue = Hive.box('offline_queue');

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.read(key: 'auth_token');
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
      onError: (error, handler) async {
        if (error.type == DioExceptionType.connectionTimeout ||
            error.type == DioExceptionType.connectionError) {
          // Queue for offline processing
          await _queueOfflineRequest(error.requestOptions);
        }
        return handler.next(error);
      },
    ));
  }

  Future<void> _queueOfflineRequest(RequestOptions options) async {
    final queueKey = 'req_${DateTime.now().millisecondsSinceEpoch}';
    await _offlineQueue.put(queueKey, {
      'method': options.method,
      'path': options.path,
      'data': options.data,
      'timestamp': DateTime.now().toIso8601String(),
    });
  }

  Future<void> syncOfflineQueue() async {
    final keys = _offlineQueue.keys.toList();
    for (final key in keys) {
      final request = _offlineQueue.get(key);
      if (request != null) {
        try {
          await _dio.request(
            request['path'],
            data: request['data'],
            options: Options(method: request['method']),
          );
          await _offlineQueue.delete(key);
        } catch (_) {
          break; // Still offline, stop trying
        }
      }
    }
  }

  // Auth
  Future<Response> login(String email, String password) =>
      _dio.post('/api/trpc/auth.login', data: {'json': {'email': email, 'password': password}});

  Future<Response> register(String name, String email, String password) =>
      _dio.post('/api/trpc/auth.register', data: {'json': {'name': name, 'email': email, 'password': password}});

  // Remittances
  Future<Response> getRemittances({int page = 1, int limit = 20}) =>
      _dio.get('/api/trpc/remittance.list', queryParameters: {'input': '{"json":{"page":$page,"limit":$limit}}'});

  Future<Response> createRemittance(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/remittance.create', data: {'json': data});

  // Disputes
  Future<Response> getDisputes({int page = 1}) =>
      _dio.get('/api/trpc/disputes.list', queryParameters: {'input': '{"json":{"page":$page}}'});

  Future<Response> createDispute(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/disputes.create', data: {'json': data});

  // Recurring Remittances
  Future<Response> getRecurringRemittances() =>
      _dio.get('/api/trpc/recurringRemittances.list');

  Future<Response> createRecurringRemittance(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/recurringRemittances.create', data: {'json': data});

  // Batch Transfers
  Future<Response> getBatchTransfers() =>
      _dio.get('/api/trpc/batchTransfers.list');

  Future<Response> createBatchTransfer(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/batchTransfers.create', data: {'json': data});

  // Support Tickets
  Future<Response> getSupportTickets() =>
      _dio.get('/api/trpc/supportTickets.list');

  Future<Response> createSupportTicket(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/supportTickets.create', data: {'json': data});

  Future<Response> sendSupportMessage(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/supportTickets.sendMessage', data: {'json': data});

  // Compliance
  Future<Response> getComplianceReports() =>
      _dio.get('/api/trpc/complianceReports.list');

  // Security
  Future<Response> getSecurityScore() =>
      _dio.get('/api/trpc/security.getSecurityScore');

  Future<Response> getSecurityEvents() =>
      _dio.get('/api/trpc/security.listEvents');

  // Referrals
  Future<Response> getMyReferralCode() =>
      _dio.get('/api/trpc/referrals.getMyCode');

  Future<Response> getMyReferrals() =>
      _dio.get('/api/trpc/referrals.myReferrals');

  // Limits
  Future<Response> getMyLimits() =>
      _dio.get('/api/trpc/transactionLimits.getMyLimits');

  // Fees
  Future<Response> getFeeConfigurations() =>
      _dio.get('/api/trpc/feeManagement.list');

  Future<Response> calculateFee(Map<String, dynamic> data) =>
      _dio.get('/api/trpc/feeManagement.calculateFee', queryParameters: {'input': '{"json":${data}}'});

  // Audit Log
  Future<Response> getAuditLogs({int page = 1, int limit = 50}) =>
      _dio.get('/api/trpc/auditLog.list', queryParameters: {'input': '{"json":{"page":$page,"limit":$limit}}'});

  // User Preferences
  Future<Response> getPreferences() =>
      _dio.get('/api/trpc/userPreferences.get');

  Future<Response> updatePreferences(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/userPreferences.update', data: {'json': data});

  // Maintenance Status
  Future<Response> getMaintenanceStatus() =>
      _dio.get('/api/trpc/maintenance.getStatus');

  // Resilience
  Future<Response> getQueueStatus() =>
      _dio.get('/api/trpc/resilience.getQueueStatus');

  Future<Response> healthCheck() =>
      _dio.get('/api/trpc/resilience.healthCheck');

  // Account Activity
  Future<Response> getAccountActivity({int page = 1, int limit = 50}) =>
      _dio.get('/api/trpc/accountActivity.list', queryParameters: {'input': '{"json":{"page":$page,"limit":$limit}}'});

  // Rate Alerts
  Future<Response> getRateAlerts() =>
      _dio.get('/api/trpc/rateAlerts.list');

  Future<Response> createRateAlert(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/rateAlerts.create', data: {'json': data});

  // Notification Settings
  Future<Response> getNotificationSettings() =>
      _dio.get('/api/trpc/notificationSettings.get');

  Future<Response> updateNotificationSettings(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/notificationSettings.update', data: {'json': data});

  // Inbound Remittance
  Future<Response> getInboundRemittances({int page = 1}) =>
      _dio.get('/api/trpc/inboundRemittance.list', queryParameters: {'input': '{"json":{"page":$page}}'});

  // Settlements
  Future<Response> getSettlements({int page = 1}) =>
      _dio.get('/api/trpc/settlements.list', queryParameters: {'input': '{"json":{"page":$page}}'});

  // Two-Factor Authentication
  Future<Response> getTwoFactorStatus() =>
      _dio.get('/api/trpc/twoFactor.getStatus');

  Future<Response> enableTwoFactor(Map<String, dynamic> data) =>
      _dio.post('/api/trpc/twoFactor.enable', data: {'json': data});
}
