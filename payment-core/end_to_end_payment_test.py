#!/usr/bin/env python3
"""
End-to-End Payment Test Script
Submits a payment via NGINX and verifies the final status in PostgreSQL.

This script performs a complete payment flow test:
1. Submit payment request through NGINX API Gateway
2. Check fraud detection score
3. Monitor payment status
4. Verify transaction in PostgreSQL database
5. Generate comprehensive test report

Requirements:
    pip install requests psycopg2-binary colorama

Usage:
    python3 end_to_end_payment_test.py
    python3 end_to_end_payment_test.py --host http://api.example.com
    python3 end_to_end_payment_test.py --verbose
"""

import sys
import json
import time
import argparse
import importlib.util
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List
from urllib.parse import urljoin

try:
    import requests
except ImportError:
    print("Error: 'requests' library not found. Install with: pip install requests")
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("Error: 'psycopg2' library not found. Install with: pip install psycopg2-binary")
    sys.exit(1)

try:
    from colorama import init, Fore, Style
    init(autoreset=True)
    COLORS_AVAILABLE = True
except ImportError:
    COLORS_AVAILABLE = False
    # Fallback to no colors
    class Fore:
        GREEN = RED = YELLOW = BLUE = CYAN = MAGENTA = WHITE = ""
    class Style:
        BRIGHT = RESET_ALL = ""


class EndToEndPaymentTest:
    """End-to-end payment test orchestrator."""
    
    def __init__(self, base_url: str = "http://localhost", db_config: Dict[str, str] = None, verbose: bool = False, adapter_dsn: Optional[str] = None):
        """Initialize test configuration."""
        self.base_url = base_url.rstrip('/')
        self.verbose = verbose
        self.adapter_dsn = adapter_dsn
        self.db_config = db_config or {
            'host': 'localhost',
            'port': 5432,
            'database': 'payment_switch',
            'user': 'payment_user',
            'password': 'payment_pass_2024'
        }
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'PaymentSwitch-E2E-Test/1.0'
        })
        self.test_results = {
            'start_time': datetime.utcnow().isoformat(),
            'tests': [],
            'summary': {}
        }
        
    def log(self, message: str, level: str = "INFO"):
        """Log message with color coding."""
        timestamp = datetime.utcnow().strftime("%H:%M:%S")
        
        if level == "SUCCESS":
            color = Fore.GREEN
            symbol = "✓"
        elif level == "ERROR":
            color = Fore.RED
            symbol = "✗"
        elif level == "WARNING":
            color = Fore.YELLOW
            symbol = "⚠"
        elif level == "INFO":
            color = Fore.CYAN
            symbol = "ℹ"
        else:
            color = Fore.WHITE
            symbol = "•"
        
        print(f"{color}[{timestamp}] {symbol} {message}{Style.RESET_ALL}")
    
    def verbose_log(self, message: str):
        """Log verbose message."""
        if self.verbose:
            print(f"{Fore.WHITE}    {message}{Style.RESET_ALL}")
    
    def test_nginx_connectivity(self) -> bool:
        """Test NGINX connectivity."""
        self.log("Testing NGINX connectivity...", "INFO")
        try:
            response = self.session.get(f"{self.base_url}/", timeout=5)
            if response.status_code == 200:
                self.log(f"NGINX is reachable (status: {response.status_code})", "SUCCESS")
                return True
            else:
                self.log(f"NGINX returned unexpected status: {response.status_code}", "WARNING")
                return False
        except requests.exceptions.RequestException as e:
            self.log(f"Failed to connect to NGINX: {e}", "ERROR")
            return False
    
    def test_database_connectivity(self) -> bool:
        """Test PostgreSQL connectivity."""
        self.log("Testing PostgreSQL connectivity...", "INFO")
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()
            cursor.execute("SELECT version();")
            version = cursor.fetchone()[0]
            cursor.close()
            conn.close()
            self.log(f"PostgreSQL is reachable", "SUCCESS")
            self.verbose_log(f"Version: {version[:50]}...")
            return True
        except Exception as e:
            self.log(f"Failed to connect to PostgreSQL: {e}", "ERROR")
            return False
    
    def submit_payment(self) -> Optional[Dict[str, Any]]:
        """Submit a payment request through NGINX."""
        self.log("Submitting payment request...", "INFO")
        
        payment_data = {
            "source": {
                "type": "MSISDN",
                "identifier": "+1234567890"
            },
            "destination": {
                "type": "MSISDN",
                "identifier": "+0987654321"
            },
            "amount": {
                "currency": "USD",
                "value": 100.00
            },
            "transactionType": "P2P",
            "channel": "MOBILE",
            "metadata": {
                "description": "E2E Test Payment",
                "test_id": f"e2e_test_{int(time.time())}"
            }
        }
        
        try:
            start_time = time.time()
            response = self.session.post(
                f"{self.base_url}/api/v1/payments/initiate",
                json=payment_data,
                timeout=30
            )
            latency = (time.time() - start_time) * 1000
            
            self.verbose_log(f"Request payload: {json.dumps(payment_data, indent=2)}")
            self.verbose_log(f"Response status: {response.status_code}")
            self.verbose_log(f"Response time: {latency:.2f}ms")
            
            if response.status_code == 200:
                result = response.json()
                transaction_id = result.get('transactionId') or result.get('transaction_id')
                self.log(f"Payment submitted successfully (ID: {transaction_id})", "SUCCESS")
                self.verbose_log(f"Response: {json.dumps(result, indent=2)}")
                
                self.test_results['tests'].append({
                    'test': 'submit_payment',
                    'status': 'PASS',
                    'latency_ms': latency,
                    'transaction_id': transaction_id,
                    'response': result
                })
                
                return result
            else:
                self.log(f"Payment submission failed (status: {response.status_code})", "ERROR")
                self.verbose_log(f"Response: {response.text}")
                
                self.test_results['tests'].append({
                    'test': 'submit_payment',
                    'status': 'FAIL',
                    'error': response.text
                })
                
                return None
                
        except requests.exceptions.RequestException as e:
            self.log(f"Payment submission error: {e}", "ERROR")
            self.test_results['tests'].append({
                'test': 'submit_payment',
                'status': 'FAIL',
                'error': str(e)
            })
            return None
    
    def check_fraud_score(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        """Check fraud detection score."""
        self.log(f"Checking fraud score for transaction {transaction_id}...", "INFO")
        
        fraud_data = {
            "transactionId": transaction_id,
            "amount": 100.00,
            "source": "+1234567890",
            "destination": "+0987654321",
            "transactionType": "P2P"
        }
        
        try:
            start_time = time.time()
            response = self.session.post(
                f"{self.base_url}/api/v1/fraud/score",
                json=fraud_data,
                timeout=10
            )
            latency = (time.time() - start_time) * 1000
            
            if response.status_code == 200:
                result = response.json()
                fraud_score = result.get('fraudScore') or result.get('fraud_score', 0)
                risk_level = result.get('riskLevel') or result.get('risk_level', 'UNKNOWN')
                
                self.log(f"Fraud score: {fraud_score:.2f} (Risk: {risk_level})", "SUCCESS")
                self.verbose_log(f"Latency: {latency:.2f}ms")
                
                self.test_results['tests'].append({
                    'test': 'check_fraud_score',
                    'status': 'PASS',
                    'latency_ms': latency,
                    'fraud_score': fraud_score,
                    'risk_level': risk_level
                })
                
                return result
            else:
                self.log(f"Fraud check failed (status: {response.status_code})", "WARNING")
                self.test_results['tests'].append({
                    'test': 'check_fraud_score',
                    'status': 'FAIL',
                    'error': response.text
                })
                return None
                
        except requests.exceptions.RequestException as e:
            self.log(f"Fraud check error: {e}", "WARNING")
            self.test_results['tests'].append({
                'test': 'check_fraud_score',
                'status': 'FAIL',
                'error': str(e)
            })
            return None
    
    def check_payment_status(self, transaction_id: str, max_attempts: int = 5) -> Optional[Dict[str, Any]]:
        """Check payment status with retry logic."""
        self.log(f"Checking payment status for transaction {transaction_id}...", "INFO")
        
        for attempt in range(1, max_attempts + 1):
            try:
                start_time = time.time()
                response = self.session.post(
                    f"{self.base_url}/api/v1/payments/status",
                    json={"transactionId": transaction_id},
                    timeout=10
                )
                latency = (time.time() - start_time) * 1000
                
                if response.status_code == 200:
                    result = response.json()
                    status = result.get('status') or result.get('transactionStatus', 'UNKNOWN')
                    
                    self.log(f"Payment status: {status} (attempt {attempt}/{max_attempts})", "SUCCESS")
                    self.verbose_log(f"Latency: {latency:.2f}ms")
                    
                    self.test_results['tests'].append({
                        'test': 'check_payment_status',
                        'status': 'PASS',
                        'latency_ms': latency,
                        'payment_status': status,
                        'attempt': attempt
                    })
                    
                    # If status is final, return
                    if status in ['COMPLETED', 'FAILED', 'REJECTED']:
                        return result
                    
                    # Wait before retry
                    if attempt < max_attempts:
                        self.verbose_log(f"Waiting 2 seconds before retry...")
                        time.sleep(2)
                else:
                    self.log(f"Status check failed (status: {response.status_code})", "WARNING")
                    
            except requests.exceptions.RequestException as e:
                self.log(f"Status check error: {e}", "WARNING")
        
        self.log(f"Payment status check timed out after {max_attempts} attempts", "WARNING")
        return None
    
    def verify_in_database(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        """Verify transaction in PostgreSQL database."""
        self.log(f"Verifying transaction {transaction_id} in database...", "INFO")
        
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Query transaction
            query = """
                SELECT 
                    transaction_id,
                    source_account,
                    destination_account,
                    amount,
                    currency,
                    status,
                    transaction_type,
                    channel,
                    created_at,
                    updated_at
                FROM transactions
                WHERE transaction_id = %s
            """
            
            cursor.execute(query, (transaction_id,))
            result = cursor.fetchone()
            
            if result:
                result_dict = dict(result)
                status = result_dict.get('status', 'UNKNOWN')
                amount = result_dict.get('amount', 0)
                
                self.log(f"Transaction found in database (Status: {status}, Amount: {amount})", "SUCCESS")
                self.verbose_log(f"Details: {json.dumps(result_dict, indent=2, default=str)}")
                
                self.test_results['tests'].append({
                    'test': 'verify_in_database',
                    'status': 'PASS',
                    'database_record': result_dict
                })
                
                cursor.close()
                conn.close()
                return result_dict
            else:
                self.log(f"Transaction not found in database", "ERROR")
                self.test_results['tests'].append({
                    'test': 'verify_in_database',
                    'status': 'FAIL',
                    'error': 'Transaction not found'
                })
                
                cursor.close()
                conn.close()
                return None
                
        except Exception as e:
            self.log(f"Database verification error: {e}", "ERROR")
            self.test_results['tests'].append({
                'test': 'verify_in_database',
                'status': 'FAIL',
                'error': str(e)
            })
            return None
    
    def verify_with_postgres_adapter(self) -> bool:
        """Run the tuned PostgreSQL adapter against its integration schema."""
        self.log("Running tuned PostgreSQL adapter smoke test...", "INFO")
        try:
            adapter_path = Path(__file__).resolve().parent / "services/database/postgres/adapter.py"
            spec = importlib.util.spec_from_file_location("paymentswitch_postgres_adapter", adapter_path)
            if spec is None or spec.loader is None:
                raise RuntimeError("unable to load PostgreSQL adapter")
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            adapter = module.PostgreSQLPaymentAdapter(self.adapter_dsn, min_connections=2, max_connections=8, isolation_level="READ COMMITTED", application_name="paymentswitch-e2e")
            try:
                adapter.seed_accounts(1, prefix="e2e")
                payload = {"transaction_id": "e2e-adapter-tx", "workflow_id": "e2e-adapter-wf", "idempotency_key": "e2e-adapter-key", "source_account": "e2e-source-0", "destination_account": "e2e-destination-0", "amount_minor": 100, "currency": "NGN"}
                first = adapter.execute_payment(payload)
                replay = adapter.execute_payment(payload)
                total = adapter.total_balance("e2e-")
                passed = first is not None and replay is not None and first.status == "completed" and first.ledger == "committed" and replay.replayed and replay.ledger == "already_exists" and total == 100000
                serialize = lambda result: result.__dict__ if result is not None else None
                self.test_results['tests'].append({'test': 'verify_with_postgres_adapter', 'status': 'PASS' if passed else 'FAIL', 'first': serialize(first), 'replay': serialize(replay), 'balance_total': total})
                if passed:
                    self.log("Tuned PostgreSQL adapter smoke test passed", "SUCCESS")
                else:
                    self.log("Tuned PostgreSQL adapter smoke test failed", "ERROR")
                return passed
            finally:
                adapter.close()
        except Exception as exc:
            self.log(f"PostgreSQL adapter smoke test error: {exc}", "ERROR")
            self.test_results['tests'].append({'test': 'verify_with_postgres_adapter', 'status': 'FAIL', 'error': str(exc)})
            return False

    def run_full_test(self) -> bool:
        """Run complete end-to-end test."""
        print(f"\n{Fore.CYAN}{'='*80}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}{Style.BRIGHT}END-TO-END PAYMENT TEST{Style.RESET_ALL}")
        print(f"{Fore.CYAN}{'='*80}{Style.RESET_ALL}\n")
        
        # Step 1: Test connectivity
        if not self.test_nginx_connectivity():
            self.log("Connectivity test failed. Aborting.", "ERROR")
            return False
        
        if not self.test_database_connectivity():
            self.log("Database connectivity test failed. Aborting.", "ERROR")
            return False
        
        print()
        
        # Step 2: Submit payment
        payment_result = self.submit_payment()
        if not payment_result:
            self.log("Payment submission failed. Aborting.", "ERROR")
            return False
        
        transaction_id = payment_result.get('transactionId') or payment_result.get('transaction_id')
        if not transaction_id:
            self.log("No transaction ID returned. Aborting.", "ERROR")
            return False
        
        print()
        
        # Step 3: Check fraud score
        self.check_fraud_score(transaction_id)
        print()
        
        # Step 4: Check payment status
        status_result = self.check_payment_status(transaction_id)
        print()
        
        # Step 5: Verify in database
        db_result = self.verify_in_database(transaction_id)
        print()

        adapter_ok = True
        if self.adapter_dsn:
            adapter_ok = self.verify_with_postgres_adapter()
            print()
        
        # Generate summary
        self.generate_summary()
        
        # Determine overall success
        all_passed = adapter_ok and all(
            test.get('status') == 'PASS'
            for test in self.test_results['tests']
        )
        
        return all_passed
    
    def generate_summary(self):
        """Generate test summary."""
        print(f"\n{Fore.CYAN}{'='*80}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}{Style.BRIGHT}TEST SUMMARY{Style.RESET_ALL}")
        print(f"{Fore.CYAN}{'='*80}{Style.RESET_ALL}\n")
        
        total_tests = len(self.test_results['tests'])
        passed_tests = sum(1 for t in self.test_results['tests'] if t.get('status') == 'PASS')
        failed_tests = total_tests - passed_tests
        
        self.test_results['summary'] = {
            'total_tests': total_tests,
            'passed': passed_tests,
            'failed': failed_tests,
            'success_rate': (passed_tests / total_tests * 100) if total_tests > 0 else 0,
            'end_time': datetime.utcnow().isoformat()
        }
        
        print(f"Total Tests:    {total_tests}")
        print(f"Passed:         {Fore.GREEN}{passed_tests}{Style.RESET_ALL}")
        print(f"Failed:         {Fore.RED}{failed_tests}{Style.RESET_ALL}")
        print(f"Success Rate:   {Fore.CYAN}{self.test_results['summary']['success_rate']:.1f}%{Style.RESET_ALL}")
        print()
        
        # Test details
        print(f"{Fore.YELLOW}Test Details:{Style.RESET_ALL}")
        for test in self.test_results['tests']:
            status_color = Fore.GREEN if test['status'] == 'PASS' else Fore.RED
            status_symbol = "✓" if test['status'] == 'PASS' else "✗"
            latency = test.get('latency_ms', 0)
            
            print(f"  {status_color}{status_symbol} {test['test']:<30} {test['status']:<6} {latency:>8.2f}ms{Style.RESET_ALL}")
        
        print()
        
        # Save results to file
        output_file = f"e2e_test_results_{int(time.time())}.json"
        with open(output_file, 'w') as f:
            json.dump(self.test_results, f, indent=2, default=str)
        
        self.log(f"Results saved to: {output_file}", "INFO")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="End-to-End Payment Test Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 end_to_end_payment_test.py
  python3 end_to_end_payment_test.py --host http://api.example.com
  python3 end_to_end_payment_test.py --verbose
  python3 end_to_end_payment_test.py --db-host 192.168.1.100
        """
    )
    
    parser.add_argument(
        '--host',
        default='http://localhost',
        help='Base URL of the NGINX API Gateway (default: http://localhost)'
    )
    
    parser.add_argument(
        '--db-host',
        default='localhost',
        help='PostgreSQL host (default: localhost)'
    )
    
    parser.add_argument(
        '--db-port',
        type=int,
        default=5432,
        help='PostgreSQL port (default: 5432)'
    )
    
    parser.add_argument(
        '--db-name',
        default='payment_switch',
        help='PostgreSQL database name (default: payment_switch)'
    )
    
    parser.add_argument(
        '--db-user',
        default='payment_user',
        help='PostgreSQL user (default: payment_user)'
    )
    
    parser.add_argument(
        '--db-password',
        default='payment_pass_2024',
        help='PostgreSQL password (default: payment_pass_2024)'
    )
    
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Enable verbose output'
    )

    parser.add_argument(
        '--adapter-dsn',
        default=None,
        help='Optional PostgreSQL DSN for the tuned adapter smoke test'
    )

    parser.add_argument(
        '--adapter-only',
        action='store_true',
        help='Run only the tuned PostgreSQL adapter integration smoke test'
    )
    
    args = parser.parse_args()
    
    # Database configuration
    db_config = {
        'host': args.db_host,
        'port': args.db_port,
        'database': args.db_name,
        'user': args.db_user,
        'password': args.db_password
    }
    
    # Run test
    tester = EndToEndPaymentTest(
        base_url=args.host,
        db_config=db_config,
        verbose=args.verbose,
        adapter_dsn=args.adapter_dsn
    )
    
    if args.adapter_only:
        if not args.adapter_dsn:
            parser.error('--adapter-only requires --adapter-dsn')
        success = tester.verify_with_postgres_adapter()
        tester.generate_summary()
    else:
        success = tester.run_full_test()
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
