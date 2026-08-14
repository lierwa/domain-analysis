"""用 allpairspy 验证冰箱采集场景的两两组合覆盖，不实现组合算法。"""

import json
from collections import OrderedDict
from importlib.metadata import version
from itertools import combinations, product
from pathlib import Path

from allpairspy import AllPairs


# WHY：因素来自当前商品采集风险；组合计算交给成熟库，避免手挑样本。
FACTORS = OrderedDict(
    {
        "brand_tier": ["head", "mid", "long_tail"],
        "identity_shape": ["single_sku", "multi_sku", "same_model_multi_offer"],
        "page_state": ["in_stock", "out_of_stock", "discontinued", "challenge"],
        "evidence_carrier": ["structured", "text", "image"],
        "price_state": ["regular", "promotion", "member_only"],
    }
)

rows = [dict(zip(FACTORS.keys(), values, strict=True)) for values in AllPairs(FACTORS.values())]

expected_pairs = set()
for left, right in combinations(FACTORS.keys(), 2):
    for left_value, right_value in product(FACTORS[left], FACTORS[right]):
        expected_pairs.add((left, left_value, right, right_value))

covered_pairs = set()
for row in rows:
    for left, right in combinations(FACTORS.keys(), 2):
        covered_pairs.add((left, row[left], right, row[right]))

result = {
    "allpairspy_version": version("allpairspy"),
    "factors": FACTORS,
    "full_cartesian_size": len(list(product(*FACTORS.values()))),
    "pairwise_scenario_count": len(rows),
    "expected_pair_count": len(expected_pairs),
    "covered_pair_count": len(expected_pairs & covered_pairs),
    "missing_pairs": sorted(expected_pairs - covered_pairs),
    "scenarios": rows,
}

Path("scenario-matrix.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
)

if result["missing_pairs"]:
    raise RuntimeError(f"pairwise coverage incomplete: {result['missing_pairs']}")

print(
    json.dumps(
        {
            key: result[key]
            for key in (
                "allpairspy_version",
                "full_cartesian_size",
                "pairwise_scenario_count",
                "expected_pair_count",
                "covered_pair_count",
            )
        },
        ensure_ascii=False,
    )
)
