"""기법 백테스트 결과(JSON) → 공유용 리포트 페이지(HTML) 생성.

python -m research.techniques_page   (techniques.py를 두 시장 모두 먼저 실행)
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "results" / "techniques"
TEMPLATE = ROOT / "techniques_template.html"
OUT = SRC / "report.html"


def slim(r: dict) -> dict:
    a, tr, te, e = r["all"], r["train"], r["test"], r["events"]
    return {
        "alpha": a["alpha"], "t": a["t_alpha"], "beta": a["beta"], "cagr": a["cagr"], "mkt": a["mkt_cagr"],
        "mdd": a["mdd"], "sharpe": a["sharpe"], "inv": a["invested"],
        "tr": tr.get("alpha"), "trt": tr.get("t_alpha"), "te": te.get("alpha"), "tet": te.get("t_alpha"),
        "n": e["n"], "win": e["win_abs"], "ret": e["mean_raw"], "med": e["median_excess"], "verdict": r["verdict"],
    }


def main() -> None:
    data = {"techs": {}, "meta": {}, "equity": {}}
    for m in ("kr", "nasdaq"):
        d = json.loads((SRC / f"{m}.json").read_text(encoding="utf-8"))
        data["meta"][m] = d["meta"]
        eq = {"dates": None, "market": None, "s": {}}
        for k, r in d["results"].items():
            t = data["techs"].setdefault(k, {"name": r["name"], "desc": r["desc"]})
            t[m] = slim(r)
            eq["dates"] = r["equity"]["dates"]
            eq["market"] = r["equity"]["market"]
            eq["s"][k] = r["equity"]["strategy"]
        data["equity"][m] = eq
    html = TEMPLATE.read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    OUT.write_text(html, encoding="utf-8")
    print(OUT, len(html) // 1024, "KB")


if __name__ == "__main__":
    main()
