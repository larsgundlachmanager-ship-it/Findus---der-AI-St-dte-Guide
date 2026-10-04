from pathlib import Path
import json
p = Path(r"c:\Users\larsf\Findus 2.0\src\assets\data\call1AutonomyScenarios.v1.json")
data = json.loads(p.read_text(encoding="utf-8"))
if "order_ticket_complete" not in data["checks"]:
    data["checks"].append("order_ticket_complete")
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("checks:", data["checks"])
