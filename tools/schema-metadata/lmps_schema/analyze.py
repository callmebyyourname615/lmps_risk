from collections import Counter
from contextlib import contextmanager
from hashlib import sha256
import logging
import re

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError, TokenError
from sqlglot.tokens import TokenType

MAX_INPUT_BYTES = 10 * 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_$]{0,127}")


class SafeDiagnostics(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.count = 0

    def emit(self, record):
        self.count += 1


@contextmanager
def parser_diagnostics():
    # Parser warnings can contain raw SQL; count them without formatting or forwarding.
    # shortcut: logging capture is process-global; isolate concurrent analyses in separate processes.
    logger = logging.getLogger("sqlglot")
    previous = logger.handlers[:], logger.propagate, logger.level
    handler = SafeDiagnostics()
    logger.handlers, logger.propagate = [handler], False
    logger.setLevel(logging.WARNING)
    try:
        yield handler
    finally:
        logger.handlers, logger.propagate = previous[:2]
        logger.setLevel(previous[2])


def identifier(value):
    return value if isinstance(value, str) and IDENTIFIER.fullmatch(value) else None


def issue(issues, code, statement=None, table=None, column=None):
    issues.append({"code": code, "statement": statement, "table": table, "column": column})


def integer_literal(node):
    if isinstance(node, exp.Literal) and not node.is_string and re.fullmatch(r"[0-9]{1,9}", node.this):
        return int(node.this)
    return None


def table_reference(node):
    if not isinstance(node, exp.Table):
        return None
    parts = [part.name for part in node.parts]
    return ".".join(parts) if parts and all(identifier(part) for part in parts) else None


def index_columns(nodes, issues, statement, table):
    columns = []
    for node in nodes:
        direction = "asc"
        if isinstance(node, exp.Ordered):
            direction = "desc" if node.args.get("desc") else "asc"
            node = node.this
        prefix = None
        if isinstance(node, exp.ColumnPrefix):
            prefix = integer_literal(node.expression)
            name = identifier(node.this.name)
            if prefix is None:
                issue(issues, "INDEX_PREFIX_NOT_EXTRACTED", statement, table)
        elif isinstance(node, (exp.Identifier, exp.Column)):
            name = identifier(node.name)
        else:
            name = None
        if name is None:
            issue(issues, "INDEX_EXPRESSION_NOT_EXTRACTED", statement, table)
        columns.append({"name": name, "prefix_length": prefix, "direction": direction})
    return columns


def extract_table(node, issues, statement):
    schema = node.this
    name = table_reference(schema.this)
    if name is None:
        issue(issues, "IDENTIFIER_NOT_EXPORTED", statement)
    table = {"name": name, "columns": [], "indexes": [], "foreign_keys": []}

    def constraint(item, constraint_name=None, inline_column=None):
        if isinstance(item, exp.Constraint):
            for child in item.expressions:
                constraint(child, identifier(item.name))
        elif isinstance(item, (exp.PrimaryKey, exp.PrimaryKeyColumnConstraint)):
            members = [exp.to_identifier(inline_column)] if inline_column else item.expressions
            table["indexes"].append({"name": "PRIMARY", "kind": "primary", "columns": index_columns(members, issues, statement, name)})
        elif isinstance(item, exp.UniqueColumnConstraint):
            if inline_column:
                members, index_name = [exp.to_identifier(inline_column)], constraint_name
            elif isinstance(item.this, exp.Schema):
                members, index_name = item.this.expressions, identifier(item.this.name)
            else:
                issue(issues, "UNIQUE_KEY_NOT_EXTRACTED", statement, name)
                return
            table["indexes"].append({"name": constraint_name or index_name, "kind": "unique", "columns": index_columns(members, issues, statement, name)})
        elif isinstance(item, exp.IndexColumnConstraint):
            kind = (item.args.get("kind") or "index").lower()
            if kind not in {"index", "fulltext", "spatial"}:
                issue(issues, "INDEX_KIND_NOT_EXTRACTED", statement, name)
                kind = "not_extracted"
            table["indexes"].append({"name": identifier(item.name), "kind": kind, "columns": index_columns(item.expressions, issues, statement, name)})
        elif isinstance(item, exp.ForeignKey):
            reference = item.args.get("reference")
            target = reference.this if isinstance(reference, exp.Reference) else None
            if not isinstance(target, exp.Schema):
                issue(issues, "FOREIGN_KEY_NOT_EXTRACTED", statement, name)
                return
            local = [identifier(column.name) for column in item.expressions]
            remote = [identifier(column.name) for column in target.expressions]
            target_name = table_reference(target.this)
            if not local or not remote or None in local + remote or target_name is None:
                issue(issues, "FOREIGN_KEY_IDENTIFIER_NOT_EXPORTED", statement, name)
            actions = []
            for action in reference.args.get("options", []):
                if isinstance(action, str) and re.fullmatch(r"ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|NO ACTION|SET DEFAULT)", action):
                    actions.append(action)
                else:
                    issue(issues, "FOREIGN_KEY_ACTION_NOT_EXTRACTED", statement, name)
            table["foreign_keys"].append({"name": constraint_name, "columns": local, "referenced_table": target_name, "referenced_columns": remote, "actions": actions})
        else:
            issue(issues, "TABLE_CONSTRAINT_NOT_EXTRACTED", statement, name)

    for child in schema.expressions:
        if not isinstance(child, exp.ColumnDef):
            constraint(child)
            continue
        column_name = identifier(child.name)
        if column_name is None:
            issue(issues, "IDENTIFIER_NOT_EXPORTED", statement, name)
        dtype = child.kind
        type_name = dtype.this.value.lower() if isinstance(dtype, exp.DataType) and isinstance(dtype.this, exp.DataType.Type) else None
        if identifier(type_name) is None:
            type_name = None
            issue(issues, "DATA_TYPE_NOT_EXTRACTED", statement, name, column_name)
        parameters, redacted = [], False
        for parameter in dtype.expressions if isinstance(dtype, exp.DataType) else []:
            value = integer_literal(parameter.this if isinstance(parameter, exp.DataTypeParam) else parameter)
            if value is None:
                redacted = True
            else:
                parameters.append(value)
        nullable, basis = (None, "server_setting_required") if type_name == "timestamptz" else (True, "implicit_mysql_default")
        column = {"name": column_name, "data_type": type_name, "numeric_parameters": parameters, "type_values_redacted": redacted, "nullable": nullable, "nullability_basis": basis, "auto_increment": False, "generated": False}
        table["columns"].append(column)
        for definition in child.args.get("constraints", []):
            kind = definition.kind
            if isinstance(kind, exp.NotNullColumnConstraint):
                column["nullable"] = bool(kind.args.get("allow_null"))
                column["nullability_basis"] = "explicit"
            elif isinstance(kind, exp.AutoIncrementColumnConstraint):
                column["auto_increment"] = True
            elif isinstance(kind, (exp.PrimaryKeyColumnConstraint, exp.UniqueColumnConstraint)):
                constraint(kind, identifier(definition.name), column_name)
            elif isinstance(kind, exp.ComputedColumnConstraint):
                column["generated"] = True
                issue(issues, "GENERATED_EXPRESSION_NOT_EXTRACTED", statement, name, column_name)
            elif isinstance(kind, exp.CheckColumnConstraint):
                issue(issues, "CHECK_EXPRESSION_NOT_EXTRACTED", statement, name, column_name)
            elif not isinstance(kind, (exp.DefaultColumnConstraint, exp.CommentColumnConstraint, exp.CharacterSetColumnConstraint, exp.CollateColumnConstraint, exp.OnUpdateColumnConstraint)):
                issue(issues, "COLUMN_CONSTRAINT_NOT_EXTRACTED", statement, name, column_name)

    primary = {column["name"] for index in table["indexes"] if index["kind"] == "primary" for column in index["columns"]}
    for column in table["columns"]:
        if column["name"] in primary:
            column["nullable"], column["nullability_basis"] = False, "primary_key"
        elif column["auto_increment"]:
            column["nullable"], column["nullability_basis"] = False, "auto_increment"
    for index in table["indexes"]:
        for member in index["columns"]:
            if member["name"] is not None and member["name"] not in {column["name"] for column in table["columns"]}:
                issue(issues, "INDEX_COLUMN_NOT_DECLARED", statement, name)
    return table


def column_list_end(tokens):
    depth = 0
    for token in tokens:
        if token.token_type == TokenType.L_PAREN:
            depth += 1
        elif token.token_type == TokenType.R_PAREN:
            depth -= 1
            if depth == 0:
                return token.end + 1
    return None


def analyze(data: bytes):
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("Input exceeds the 10 MiB DDL limit.")
    source = data.decode("utf-8-sig")
    issues, tables, counts = [], [], Counter()
    with parser_diagnostics() as diagnostics:
        try:
            tokens = sqlglot.tokenize(source, read="mysql")
        except TokenError:
            tokens = []
            issue(issues, "TOKENIZATION_FAILED")
        for token in tokens:
            for comment in token.comments:
                if re.match(r"^(?:!|M!)(?:[0-9]{5,6})?\s*SET\b", comment, re.I):
                    counts["executable_setup_comments_omitted"] += 1
                elif re.match(r"^(?:!|M!)", comment):
                    issue(issues, "EXECUTABLE_COMMENT_NOT_EXTRACTED")
        start, statement = 0, 0
        ends = [index for index, token in enumerate(tokens) if token.token_type == TokenType.SEMICOLON] + [len(tokens)]
        for end in ends:
            chunk = tokens[start:end]
            start = end + 1
            if not chunk:
                continue
            statement += 1
            first = chunk[0].token_type
            if first in {TokenType.DROP, TokenType.SET, TokenType.USE}:
                counts["non_inventory_statements_omitted"] += 1
                continue
            if first != TokenType.CREATE:
                issue(issues, "STATEMENT_NOT_EXTRACTED", statement)
                continue
            try:
                node = sqlglot.parse_one(source[chunk[0].start:chunk[-1].end + 1], read="mysql")
            except ParseError:
                node = None
            if not isinstance(node, exp.Create) or not isinstance(node.this, exp.Schema):
                stop = column_list_end(chunk)
                try:
                    node = sqlglot.parse_one(source[chunk[0].start:stop], read="mysql") if stop else None
                except ParseError:
                    node = None
                issue(issues, "CREATE_TAIL_OR_SYNTAX_NOT_EXTRACTED", statement)
            if not isinstance(node, exp.Create) or node.kind != "TABLE" or not isinstance(node.this, exp.Schema):
                issue(issues, "CREATE_SHAPE_NOT_EXTRACTED", statement)
                continue
            if node.args.get("expression") is not None:
                issue(issues, "CREATE_AS_QUERY_NOT_EXTRACTED", statement)
            table = extract_table(node, issues, statement)
            if any(existing["name"] == table["name"] for existing in tables):
                issue(issues, "DUPLICATE_TABLE_DECLARATION", statement, table["name"])
            table.update({"statement": statement, "source_line": chunk[0].line})
            tables.append(table)
            properties = node.args.get("properties")
            if properties:
                for prop in properties.expressions:
                    if not isinstance(prop, (exp.EngineProperty, exp.CharacterSetProperty, exp.CollateProperty, exp.AutoIncrementProperty, exp.SchemaCommentProperty)):
                        issue(issues, "TABLE_PROPERTY_NOT_EXTRACTED", statement, table["name"])
        if diagnostics.count:
            issue(issues, "PARSER_WARNINGS_REDACTED")
        counts["parser_warning_count"] = diagnostics.count
        counts["statements_seen"] = statement
    if not tables:
        issue(issues, "NO_TABLE_DEFINITIONS_EXTRACTED")
    counts.update({"tables": len(tables), "columns": sum(len(table["columns"]) for table in tables), "indexes": sum(len(table["indexes"]) for table in tables), "foreign_keys": sum(len(table["foreign_keys"]) for table in tables)})
    return {
        "report_version": "0.1.0",
        "source": {"sha256": sha256(data).hexdigest(), "bytes": len(data)},
        "parser": {"name": "sqlglot", "version": sqlglot.__version__, "dialect": "mysql"},
        "coverage": "partial" if issues else "complete_for_supported_inventory",
        "counts": dict(counts),
        "omitted_metadata": ["comments", "defaults", "enum_set_values", "table_storage_options", "index_storage_options", "on_update_expressions", "raw_sql", "data_rows"],
        "issues": issues,
        "tables": tables,
    }
