from kavach import migrations
from kavach.eventlog import connect


def test_apply_is_idempotent_and_records_versions():
    c = connect(":memory:")
    first = migrations.apply(c)
    assert first == [v for v, _, _ in migrations.MIGRATIONS]
    assert migrations.apply(c) == []
    rows = c.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
    assert [r["version"] for r in rows] == first
