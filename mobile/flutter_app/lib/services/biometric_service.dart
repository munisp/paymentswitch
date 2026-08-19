import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart' as local_auth;

enum BiometricType { fingerprint, faceId, iris, none }

class BiometricService {
  BiometricService({local_auth.LocalAuthentication? localAuthentication})
      : _localAuthentication = localAuthentication ?? local_auth.LocalAuthentication();

  static final BiometricService _instance = BiometricService._internal();
  factory BiometricService() => _instance;
  BiometricService._internal() : _localAuthentication = local_auth.LocalAuthentication();

  final local_auth.LocalAuthentication _localAuthentication;
  bool _isAvailable = false;
  BiometricType _type = BiometricType.none;

  Future<bool> checkAvailability() async {
    try {
      final supported = await _localAuthentication.isDeviceSupported();
      final canCheck = await _localAuthentication.canCheckBiometrics;
      if (!supported || !canCheck) {
        _isAvailable = false;
        _type = BiometricType.none;
        return false;
      }
      final biometrics = await _localAuthentication.getAvailableBiometrics();
      _type = biometrics.contains(local_auth.BiometricType.face) || biometrics.contains(local_auth.BiometricType.strong)
          ? BiometricType.faceId
          : biometrics.contains(local_auth.BiometricType.iris)
              ? BiometricType.iris
              : biometrics.contains(local_auth.BiometricType.fingerprint) || biometrics.contains(local_auth.BiometricType.weak)
                  ? BiometricType.fingerprint
                  : BiometricType.none;
      _isAvailable = _type != BiometricType.none;
      return _isAvailable;
    } catch (error) {
      debugPrint('[Biometric] Availability check failed: $error');
      _isAvailable = false;
      _type = BiometricType.none;
      return false;
    }
  }

  BiometricType get biometricType => _type;
  bool get isAvailable => _isAvailable;

  Future<bool> authenticate({String reason = 'Verify your identity'}) async {
    if (!await checkAvailability()) return false;
    try {
      return await _localAuthentication.authenticate(
        localizedReason: reason,
        options: const local_auth.AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
          sensitiveTransaction: true,
        ),
      );
    } catch (error) {
      debugPrint('[Biometric] Authentication failed: $error');
      return false;
    }
  }

  Future<bool> authenticateForPayment(double amount, String currency) =>
      authenticate(reason: 'Authorize payment of $currency ${amount.toStringAsFixed(2)}');

  Future<bool> authenticateForLogin() => authenticate(reason: 'Sign in to Payment Switch');
}
