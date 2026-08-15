from pathlib import Path
import sqlite3
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from run_local_sqlite_payment_switch import SCHEMA, execute_payment, open_db
path = Path('/tmp/diagnose-bench.sqlite3')
if path.exists(): path.unlink()
conn = sqlite3.connect(path)
conn.executescript(SCHEMA)
conn.executemany('INSERT INTO accounts VALUES(?,?,?)', [('sqlite-source-0',100000,'NGN'),('sqlite-destination-0',0,'NGN')])
conn.close()
job={'transaction_id':'sqlite-tx-0','workflow_id':'sqlite-wf-0','idempotency_key':'sqlite-key-0','source_account':'sqlite-source-0','destination_account':'sqlite-destination-0','amount_minor':100,'currency':'NGN'}
print('result', execute_payment(path, job))
conn=open_db(path)
print('accounts', conn.execute('select account_id,balance_minor from accounts').fetchall())
print('payments', conn.execute('select * from payments').fetchall())
conn.close()
