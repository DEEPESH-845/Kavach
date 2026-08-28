#!/usr/bin/env python3
"""Entrypoint: Web API Server."""

import argparse
import logging
import uvicorn
from pydantic import BaseModel
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kavach.eventlog import connect
from kavach.services import dashboard

# Initialize FastAPI app
app = FastAPI(
    title="Kavach API",
    description="Financial-truth and action-governance layer API",
    version="0.1.0",
)

# Allow CORS for local Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()

@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "0.1.0"}

@app.get("/api/dashboard/overview")
def dashboard_overview():
    conn = connect()
    try:
        metrics = dashboard.get_overview_metrics(conn)
        return {"data": metrics}
    finally:
        conn.close()

@app.get("/api/dashboard/activity")
def dashboard_activity():
    conn = connect()
    try:
        activity = dashboard.get_recent_activity(conn)
        return {"data": activity}
    finally:
        conn.close()

from kavach.services import intents

@app.get("/api/intents")
def list_intents():
    conn = connect()
    try:
        return {"data": intents.get_all_intents(conn)}
    finally:
        conn.close()

@app.get("/api/intents/{intent_id}")
def get_intent(intent_id: str):
    conn = connect()
    try:
        data = intents.get_intent_detail(conn, intent_id)
        if not data:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Intent not found")
        return {"data": data}
    finally:
        conn.close()

from kavach.services import financials
from kavach.ledger import open_obligations

@app.get("/api/payments")
def list_payments():
    conn = connect()
    try:
        return {"data": financials.get_all_payments(conn)}
    finally:
        conn.close()

@app.get("/api/payments/{payment_id}")
def get_payment(payment_id: str):
    conn = connect()
    try:
        data = financials.get_payment_detail(conn, payment_id)
        if not data:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Payment not found")
        return {"data": data}
    finally:
        conn.close()

@app.get("/api/refunds")
def list_refunds():
    conn = connect()
    try:
        return {"data": financials.get_all_refunds(conn)}
    finally:
        conn.close()

@app.get("/api/refunds/{refund_id}")
def get_refund(refund_id: str):
    conn = connect()
    try:
        data = financials.get_refund_detail(conn, refund_id)
        if not data:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Refund not found")
        return {"data": data}
    finally:
        conn.close()

import time

@app.get("/api/obligations")
def list_obligations():
    conn = connect()
    try:
        now = int(time.time())
        obs = open_obligations(conn, now)
        return {"data": [o.to_agent() for o in obs]}
    finally:
        conn.close()

@app.get("/api/approvals")
def list_approvals():
    conn = connect()
    try:
        return {"data": intents.get_approvals(conn)}
    finally:
        conn.close()

@app.get("/api/reconciliations")
def list_reconciliations():
    conn = connect()
    try:
        return {"data": intents.get_reconciliations(conn)}
    finally:
        conn.close()

from kavach.services import agents

@app.get("/api/agents")
def list_agents():
    conn = connect()
    try:
        return {"data": agents.get_all_agents(conn)}
    finally:
        conn.close()

@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: str):
    conn = connect()
    try:
        data = agents.get_agent_detail(conn, agent_id)
        if not data:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Agent not found")
        return {"data": data}
    finally:
        conn.close()

from pydantic import BaseModel
from typing import Optional, Dict, Any

class IntentPayload(BaseModel):
    agent_id: str
    session_id: str
    tool: str
    target_type: str
    target_id: str
    amount_minor: int
    reason_text: str

@app.post("/api/gate/intent")
def evaluate_intent(payload: IntentPayload):
    from kavach.governor import evaluate_and_record
    conn = connect()
    try:
        decision, intent_id = evaluate_and_record(
            conn, 
            agent_id=payload.agent_id,
            session_id=payload.session_id,
            tool=payload.tool,
            target_type=payload.target_type,
            target_id=payload.target_id,
            amount_minor=payload.amount_minor,
            reason_text=payload.reason_text
        )
        return {"data": {"intent_id": intent_id, "decision": decision}}
    finally:
        conn.close()

@app.get("/api/proofs")
def list_proofs():
    conn = connect()
    try:
        return {"data": intents.get_proofs(conn)}
    finally:
        conn.close()

def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    logging.info("Starting Kavach API Server on %s:%d...", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
