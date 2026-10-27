import re

FIELD_CANDIDATES = {
    "row_identifier": {"id", "transaction_id", "txid"},
    "transaction_reference": {"reference", "originalreference", "transaction_reference"},
    "sender_account_field": {"fromaccount", "sender_account_id", "sender_account_token"},
    "receiver_account_field": {"toaccount", "receiver_account_id", "receiver_account_token"},
    "sender_related_unverified": {"fromuser"},
    "routing_or_bank_field": {"frommember", "tomember", "source_bank_id", "destination_bank_id", "iin"},
    "money_or_currency": {"amount", "fee", "ccy", "currency", "currencycode"},
    "lifecycle_or_status": {"result", "status", "shouldrevert", "isreconciled", "issettled"},
    "product_or_channel": {"txtype", "totype", "qrtype", "fromchannel", "channel"},
}
UNVERIFIED = [
    "Live schema equivalence, actual row counts, distributions and uniqueness across feeds/history.",
    "Masked/full account representation, stable account identity, ownership and cross-role linkage.",
    "Routing participant versus account-owning bank mapping; currency units and lifecycle codebooks.",
    "Event/observed time semantics, historical availability, session timezone and timestamp settings.",
    "History overlap/move/copy semantics and business payment deduplication across tables.",
    "Binlog configuration, CDC compatibility/permissions, replica lag and snapshot/source impact.",
    "Peak/burst TPS, query plans, real performance and five-million-payments/day capacity.",
]


def enrich(report):
    candidates, history = [], []
    for table in report["tables"]:
        name = table["name"]
        if name and re.search(r"(^backup_|_hist(?:ory)?(?:_|$)|_old(?:_|$)|_[0-9]{8}$)", name, re.I):
            history.append(name)
        for column in table["columns"]:
            column_name = column["name"]
            if not column_name:
                continue
            roles = [role for role, names in FIELD_CANDIDATES.items() if column_name.lower() in names]
            if column["data_type"] in {"date", "datetime", "timestamp", "timestamptz"}:
                roles.append("time_field")
            if roles:
                candidates.append({"table": name, "column": column_name, "roles": roles})
    report["field_candidates"] = candidates
    report["history_or_backup_name_candidates"] = history
    report["candidate_basis"] = "Names/types only, not confirmed source mapping or identity. History names do not prove overlap."
    report["unverified"] = UNVERIFIED
    return report


def render_markdown(report):
    counts = report["counts"]
    lines = [
        "# Offline DDL metadata inventory", "",
        f"Coverage: **{report['coverage']}**. This is an inventory of declarations, not live database verification.", "",
        f"Source SHA-256: `{report['source']['sha256']}`; bytes: {report['source']['bytes']}.",
        f"Parser: SQLGlot {report['parser']['version']}, MySQL dialect; report {report['report_version']}.", "",
        f"Tables: {counts['tables']}; columns: {counts['columns']}; indexes: {counts['indexes']}; foreign keys: {counts['foreign_keys']}.", "",
        "Comments, default/enum values, raw SQL, data rows and storage-option values are not exported.",
        "Data types are parser-normalized. `timestamptz` is SQLGlot's MySQL TIMESTAMP representation; it does not confirm source timezone settings.",
        "Nullable is inferred from explicit NULL/NOT NULL, primary keys, auto-increment or the ordinary MySQL default. An unspecified TIMESTAMP is unknown pending server settings.", "",
        "## Unverified inputs", "",
        *[f"- {item}" for item in report["unverified"]], "",
        "## Coverage issues", "",
    ]
    if report["issues"]:
        lines += ["| Code | Statement | Table | Column |", "| --- | --- | --- | --- |"]
        for item in report["issues"]:
            lines.append(f"| {item['code']} | {item['statement'] or '-'} | {item['table'] or '-'} | {item['column'] or '-'} |")
    else:
        lines.append("No unsupported constructs detected within the supported inventory subset.")
    lines += ["", "## History/backup name candidates", "", report["candidate_basis"], ""]
    lines += [f"- `{name}`" for name in report["history_or_backup_name_candidates"]] or ["None detected by the bounded name heuristic."]
    lines += ["", "## Field candidates requiring owner review", "", "| Table | Column | Candidate roles |", "| --- | --- | --- |"]
    for candidate in report["field_candidates"]:
        lines.append(f"| {candidate['table'] or '-'} | {candidate['column']} | {', '.join(candidate['roles'])} |")
    for table in report["tables"]:
        lines += ["", f"## Table `{table['name'] or 'redacted_identifier'}`", "", "| Column | Normalized type | Nullable | Basis | Auto increment | Generated |", "| --- | --- | --- | --- | --- | --- |"]
        for column in table["columns"]:
            dtype = column["data_type"] or "not_extracted"
            if column["numeric_parameters"]:
                dtype += "(" + ",".join(map(str, column["numeric_parameters"])) + ")"
            if column["type_values_redacted"]:
                dtype += " [values omitted]"
            nullable = "unknown" if column["nullable"] is None else str(column["nullable"]).lower()
            lines.append(f"| {column['name'] or 'redacted_identifier'} | {dtype} | {nullable} | {column['nullability_basis']} | {column['auto_increment']} | {column['generated']} |")
        lines += ["", "Declared keys/indexes:", ""]
        for index in table["indexes"]:
            members = []
            for column in index["columns"]:
                member = column["name"] or "expression_not_extracted"
                if column["prefix_length"] is not None:
                    member += f"({column['prefix_length']})"
                members.append(member + " " + column["direction"])
            lines.append(f"- {index['kind']} `{index['name'] or 'unnamed'}`: {', '.join(members)}")
        if not table["indexes"]:
            lines.append("- None declared in this CREATE TABLE.")
        for key in table["foreign_keys"]:
            local = ", ".join(name or "not_extracted" for name in key["columns"])
            remote = ", ".join(name or "not_extracted" for name in key["referenced_columns"])
            lines.append(f"- foreign key `{key['name'] or 'unnamed'}`: ({local}) -> `{key['referenced_table'] or 'not_extracted'}` ({remote}); {', '.join(key['actions'])}")
    return "\n".join(lines) + "\n"
