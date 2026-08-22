from pathlib import Path

rows = []
current = None
for line in Path("coverage/lcov.info").read_text(encoding="utf-8").splitlines():
    if line.startswith("SF:"):
        current = {"file": line[3:]}
    elif line.startswith("LF:") and current is not None:
        current["lf"] = int(line[3:])
    elif line.startswith("LH:") and current is not None:
        current["lh"] = int(line[3:])
    elif line == "end_of_record" and current is not None:
        current["uncovered"] = current["lf"] - current["lh"]
        rows.append(current)
        current = None

for row in sorted(rows, key=lambda item: item["uncovered"], reverse=True)[:30]:
    print(
        f'{row["uncovered"]:5} uncovered / {row["lf"]:5} lines / '
        f'{row["lh"]:5} hit  {row["file"]}'
    )
