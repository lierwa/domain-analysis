import json
import pathlib
import sys

import great_expectations as gx
import pandas as pd


def validate_file(csv_path: pathlib.Path) -> dict:
    frame = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    context = gx.get_context(mode="ephemeral")
    data_source = context.data_sources.add_pandas("r011-pandas")
    asset = data_source.add_dataframe_asset(name="knowledge-claims")
    batch_definition = asset.add_batch_definition_whole_dataframe("whole-file")

    suite = context.suites.add(
        gx.ExpectationSuite(name="knowledge-claim-hard-gates")
    )
    suite.add_expectation(gx.expectations.ExpectColumnValuesToNotBeNull(column="claim_id"))
    suite.add_expectation(gx.expectations.ExpectColumnValuesToBeUnique(column="claim_id"))
    suite.add_expectation(gx.expectations.ExpectColumnValuesToNotBeNull(column="model_id"))
    suite.add_expectation(
        gx.expectations.ExpectColumnValuesToBeInSet(
            column="knowledge_layer",
            value_set=[
                "specification",
                "function",
                "mechanism",
                "applicability",
                "tradeoff",
                "need_mapping",
                "comparison",
            ],
        )
    )
    suite.add_expectation(
        gx.expectations.ExpectColumnValuesToBeInSet(
            column="claim_status",
            value_set=[
                "source_fact",
                "deterministic_transform",
                "model_candidate",
                "human_confirmed",
                "conflict",
                "unknown",
            ],
        )
    )
    suite.add_expectation(
        gx.expectations.ExpectColumnValuesToMatchRegex(
            column="evidence_ref", regex=r"^.+$"
        )
    )
    suite.add_expectation(
        gx.expectations.ExpectColumnValuesToMatchRegex(
            column="captured_at",
            regex=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
        )
    )
    suite.add_expectation(
        gx.expectations.ExpectColumnValuesToBeInSet(
            column="conflict_visible", value_set=["true", "false"]
        )
    )

    validation = context.validation_definitions.add(
        gx.ValidationDefinition(
            name=f"validate-{csv_path.stem}", data=batch_definition, suite=suite
        )
    )
    result = validation.run(batch_parameters={"dataframe": frame})
    failures = [
        item.expectation_config.type
        for item in result.results
        if not item.success
    ]
    return {"file": csv_path.name, "success": result.success, "failures": failures}


if __name__ == "__main__":
    base = pathlib.Path(__file__).parent
    results = [validate_file(base / name) for name in sys.argv[1:]]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    raise SystemExit(0 if all(result["success"] for result in results) else 1)
