#!/usr/bin/env python3
from pathlib import Path


def main() -> int:
    wf = Path("scripts/local_temporal_ledger_workflow.py").read_text()
    worker = Path("scripts/run_local_temporal_ledger_workflow.py").read_text()
    test = Path("tests/integration/test_temporal_tigerbeetle_split_brain.py").read_text()
    report = Path("audit/final-go-gate-and-double-spend-analysis.md").read_text()
    checks = {
        "transfer-id lookup": "lookup_transfers" in wf,
        "payload comparison": "same_payload" in wf,
        "reconciliation activity": "async def reconcile_accounts" in wf,
        "reconciliation result gate": 'if not reconciliation["balanced"]' in wf,
        "worker registration": "reconcile_accounts" in worker,
        "same workflow handle": "handle.result()" in test,
        "exact reconciliation assertions": "assert_reconciled" in test,
        "partition deny policy": "deny-all ingress" in test,
        "GO-gate report": "Conditional NO-GO" in report,
    }
    for name, passed in checks.items():
        print(("PASS " if passed else "FAIL ") + name)
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
