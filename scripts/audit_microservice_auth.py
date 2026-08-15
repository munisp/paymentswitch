#!/usr/bin/env python3
from __future__ import annotations
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "payment-core" / "services"
ROUTE = re.compile(r"@(router|app)\.(get|post|put|patch|delete)\(([^\n]+)")
AUTH = re.compile(r"(Depends\([^\n]*(auth|jwt|user|permission|role|keycloak|permify)|authorize|require_auth|verify_token|current_user|keycloak|permify)", re.I)
PUBLIC = re.compile(r"/(health|ready|live|metrics|openapi|docs)(?:[\"'\s),]|$)", re.I)
rows=[]
for path in sorted(ROOT.rglob("*.py")):
    text=path.read_text(errors="ignore")
    for match in ROUTE.finditer(text):
        line=text.count("\n",0,match.start())+1
        route=match.group(3).strip()
        body=text[match.end():match.end()+1100]
        is_public=bool(PUBLIC.search(route))
        has_auth=bool(AUTH.search(body))
        rows.append({"service":path.parent.name,"file":str(path.relative_to(ROOT.parent.parent)),"line":line,"route":route,"public_candidate":is_public,"auth_heuristic":has_auth})
summary={
    "route_count":len(rows),
    "business_route_count":sum(not r["public_candidate"] for r in rows),
    "business_routes_without_visible_auth":sum(not r["public_candidate"] and not r["auth_heuristic"] for r in rows),
    "routes":rows,
}
out=Path(__file__).resolve().parents[1]/"audit"/"artifacts"/"microservice-auth-audit.json"
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps({k:v for k,v in summary.items() if k != "routes"},indent=2))
print("--- gaps ---")
for row in rows:
    if not row["public_candidate"] and not row["auth_heuristic"]:
        print(f"{row['service']}\t{row['file']}:{row['line']}\t{row['route']}")
