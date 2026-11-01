import io


def test_account_lifecycle_and_liability_sign(client):
    r = client.post("/api/accounts", json={"name": "Visa", "type": "credit", "balance": 320})
    assert r.status_code == 201 and r.json()["balance"] == -320.0
    aid = r.json()["id"]
    r = client.post(f"/api/accounts/{aid}/balance", json={"balance": 100})
    assert r.json()["balance"] == -100.0
    assert client.get("/api/net-worth").json()["current"]["liabilities"] == -100.0
    client.patch(f"/api/accounts/{aid}", json={"archived": True})
    assert client.get("/api/net-worth").json()["current"]["net_worth"] == 0


def test_csv_import_endpoint_and_transaction_edit_with_rule(client):
    aid = client.post("/api/accounts", json={"name": "Chk", "type": "checking"}).json()["id"]
    csv = "Date,Description,Amount\n2026-10-01,ZZYZX WIDGETS,-20.00\n2026-10-08,ZZYZX WIDGETS,-20.00\n2026-10-09,ACME PAYROLL,2500\n"
    r = client.post("/api/import", data={"account_id": aid, "profile": "auto"}, files={"file": ("x.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert r.status_code == 200 and r.json()["imported"] == 3
    unc = client.get("/api/transactions?uncategorized=true").json()
    assert unc["total"] == 2
    tid = unc["items"][0]["id"]
    shop = next(c["id"] for c in client.get("/api/categories").json() if c["name"] == "Shopping")
    r = client.patch(f"/api/transactions/{tid}", json={"category_id": shop, "create_rule": True, "tags": ["work"]})
    assert r.json()["category"] == "Shopping" and r.json()["rule_applied_to"] == 1 and r.json()["tags"] == ["work"]
    assert client.get("/api/transactions?uncategorized=true").json()["total"] == 0
    assert client.get("/api/transactions?tag=work").json()["total"] == 1
    assert "ZZYZX" in client.get("/api/export/transactions.csv").text


def test_splits_must_balance(client):
    aid = client.post("/api/accounts", json={"name": "Chk", "type": "checking"}).json()["id"]
    t = client.post("/api/transactions", json={"account_id": aid, "date": "2026-10-01", "amount": -100, "description": "COSTCO"}).json()
    cats = {c["name"]: c["id"] for c in client.get("/api/categories").json()}
    bad = client.put(f"/api/transactions/{t['id']}/splits", json=[{"amount": -60, "category_id": cats["Groceries"]}, {"amount": -30, "category_id": cats["Shopping"]}])
    assert bad.status_code == 400
    ok = client.put(f"/api/transactions/{t['id']}/splits", json=[{"amount": -60, "category_id": cats["Groceries"]}, {"amount": -40, "category_id": cats["Shopping"]}])
    assert ok.status_code == 200 and len(ok.json()["splits"]) == 2


def test_budgets_goals_recurring_endpoints(client):
    cats = {c["name"]: c["id"] for c in client.get("/api/categories").json()}
    assert client.put("/api/budgets", json={"category_id": cats["Groceries"], "amount": 400}).status_code == 200
    bs = client.get("/api/budgets").json()
    assert next(r for r in bs["rows"] if r["category"] == "Groceries")["budget"] == 400
    aid = client.post("/api/accounts", json={"name": "Sav", "type": "savings", "balance": 2500}).json()["id"]
    g = client.post("/api/goals", json={"name": "Fund", "target_amount": 10000, "account_id": aid, "monthly_contribution": 500}).json()
    assert g["current"] == 2500 and g["pct"] == 0.25 and g["eta_months"] == 15
    assert client.get("/api/recurring").json()["items"] == []
    assert client.get("/api/overview").status_code == 200
    assert client.get("/").status_code == 200


def test_plaid_status_unconfigured(client, monkeypatch):
    monkeypatch.delenv("PLAID_CLIENT_ID", raising=False)
    monkeypatch.delenv("PLAID_SECRET", raising=False)
    assert client.get("/api/plaid/status").json()["configured"] is False
    assert client.post("/api/plaid/link-token", json={}).status_code == 400
