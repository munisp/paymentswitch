/// Form validation utilities for financial inputs.
///
/// All validators return null on success or an error message string.
class Validators {
  Validators._();

  static String? required(String? value, [String field = 'This field']) {
    if (value == null || value.trim().isEmpty) return '$field is required';
    return null;
  }

  static String? email(String? value) {
    if (value == null || value.trim().isEmpty) return 'Email is required';
    final regex = RegExp(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');
    if (!regex.hasMatch(value.trim())) return 'Enter a valid email address';
    return null;
  }

  static String? password(String? value) {
    if (value == null || value.isEmpty) return 'Password is required';
    if (value.length < 8) return 'Password must be at least 8 characters';
    return null;
  }

  static String? amount(String? value, {double min = 1, double max = 50000000}) {
    if (value == null || value.trim().isEmpty) return 'Amount is required';
    final parsed = double.tryParse(value.replaceAll(',', ''));
    if (parsed == null) return 'Enter a valid number';
    if (parsed < min) return 'Minimum amount is ${min.toStringAsFixed(0)}';
    if (parsed > max) return 'Maximum amount is ${max.toStringAsFixed(0)}';
    return null;
  }

  static String? accountNumber(String? value) {
    if (value == null || value.trim().isEmpty) return 'Account number is required';
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length != 10) return 'Account number must be 10 digits';
    return null;
  }

  static String? bvn(String? value) {
    if (value == null || value.trim().isEmpty) return 'BVN is required';
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length != 11) return 'BVN must be 11 digits';
    return null;
  }

  static String? nin(String? value) {
    if (value == null || value.trim().isEmpty) return 'NIN is required';
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length != 11) return 'NIN must be 11 digits';
    return null;
  }

  static String? phone(String? value) {
    if (value == null || value.trim().isEmpty) return 'Phone number is required';
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 10 || digits.length > 15) return 'Enter a valid phone number';
    return null;
  }

  static String? recipientName(String? value) {
    if (value == null || value.trim().isEmpty) return 'Recipient name is required';
    if (value.trim().length < 2) return 'Name must be at least 2 characters';
    if (value.trim().length > 100) return 'Name must be under 100 characters';
    return null;
  }

  static String? narration(String? value) {
    if (value != null && value.length > 200) return 'Narration must be under 200 characters';
    return null;
  }

  static String? disputeReason(String? value) {
    if (value == null || value.trim().isEmpty) return 'Reason is required';
    if (value.trim().length < 10) return 'Please provide a detailed reason (min 10 characters)';
    return null;
  }

  static String? transactionRef(String? value) {
    if (value == null || value.trim().isEmpty) return 'Transaction reference is required';
    return null;
  }
}
