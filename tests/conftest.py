import pytest
from fastapi.testclient import TestClient

from ledger import db, api


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


@pytest.fixture
def client(conn):
    api.set_connection(conn)
    return TestClient(api.app)


@pytest.fixture
def checking(conn):
    cur = conn.execute("INSERT INTO accounts (name, type) VALUES ('Checking', 'checking')")
    conn.commit()
    return cur.lastrowid


@pytest.fixture
def card(conn):
    cur = conn.execute("INSERT INTO accounts (name, type) VALUES ('Card', 'credit')")
    conn.commit()
    return cur.lastrowid
