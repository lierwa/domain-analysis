"""用 statsmodels 展示质量目标如何推导样本量，不实现统计公式。"""

import json
import math
from pathlib import Path

import statsmodels
from statsmodels.stats.proportion import proportion_confint, samplesize_confint_proportion


# WHY：这些是对比用参数，不是已接受的产品门槛；正式值必须来自风险等级映射。
TARGETS = [
    {"confidence": 0.90, "expected_success": 0.90, "margin": 0.10},
    {"confidence": 0.95, "expected_success": 0.95, "margin": 0.05},
    {"confidence": 0.95, "expected_success": 0.95, "margin": 0.02},
    {"confidence": 0.99, "expected_success": 0.99, "margin": 0.02},
]

estimated_sample_sizes = []
for target in TARGETS:
    size = samplesize_confint_proportion(
        proportion=target["expected_success"],
        half_length=target["margin"],
        alpha=1 - target["confidence"],
        method="normal",
    )
    estimated_sample_sizes.append({**target, "sample_size": math.ceil(size)})

zero_error_bounds = []
for size in (20, 50, 59, 100):
    lower, _ = proportion_confint(count=size, nobs=size, alpha=0.10, method="beta")
    zero_error_bounds.append(
        {
            "sample_size": size,
            "observed_successes": size,
            "one_sided_95_percent_lower_bound": round(float(lower), 6),
        }
    )

result = {
    "statsmodels_version": statsmodels.__version__,
    "estimated_sample_sizes": estimated_sample_sizes,
    "zero_error_bounds": zero_error_bounds,
}

Path("sample-size-evidence.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps(result, ensure_ascii=False))
