from pathlib import Path
import importlib.util
path = Path(__file__).resolve().parents[1] / 'payment-core/services/database/postgres/adapter.py'
spec = importlib.util.spec_from_file_location('diagnose_adapter', path)
module = importlib.util.module_from_spec(spec)
import sys
sys.modules['diagnose_adapter'] = module
spec.loader.exec_module(module)
adapter = module.PostgreSQLPaymentAdapter('host=127.0.0.1 port=5432 dbname=paymentswitch_benchmark user=paymentswitch_bench password=paymentswitch_bench_local_only', min_connections=2, max_connections=8, isolation_level='READ COMMITTED', application_name='diagnose-adapter')
try:
    adapter.seed_accounts(1)
    payload={'transaction_id':'diagnose-tx','workflow_id':'diagnose-wf','idempotency_key':'diagnose-key','source_account':'pg-source-0','destination_account':'pg-destination-0','amount_minor':100,'currency':'NGN'}
    first=adapter.execute_payment(payload)
    replay=adapter.execute_payment(payload)
    print('first_type',type(first), 'first', first)
    print('replay_type',type(replay), 'replay', replay)
    print('first_dict', getattr(first,'__dict__',None))
    print('replay_dict', getattr(replay,'__dict__',None))
    print('total',adapter.total_balance())
finally:
    adapter.close()
