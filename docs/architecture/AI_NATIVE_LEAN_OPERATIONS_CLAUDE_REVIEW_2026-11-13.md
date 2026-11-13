# BED4BOOK — AI-Native Operations & Lean Team Architecture Review
Date: 2026-11-13
Status: DISCUSSION ONLY — Claude technical review requested
Owner decision: No code, database, migration, API, production, or master specification changes are authorized by this document.

## Business objective
BED4BOOK is being designed as a hotel wholesale marketplace that can scale transaction volume without proportional headcount growth. ChatGPT and Claude currently assist with software delivery; the owner's Intel i7-11800H / 32 GB RAM / RTX 3050 Ti 4 GB computer is a management terminal, NOT a required local inference server. Cloud services and AI should handle heavy processing. Do not propose hardware purchases or a separate duplicate AI management platform.

The existing platform↔DMC business rules remain authoritative: DMCs may sell and buy; buyer sees only BED4BOOK as provider; seller identity and internal pricing/margin/fees remain hidden; the platform controls distribution and markup; sub-agencies are managed through their DMC. Existing approval and tenant-isolation constraints must remain intact.

## Desired operating model
1. Deterministic software owns reservation state, inventory, pricing arithmetic, permissions, settlement calculations, and accounting invariants. LLMs do not directly override business rules.
2. AI agents handle unstructured inputs, email triage, incident diagnosis, support workflows, code-review assistance, exception handling, and bounded decisions.
3. A durable orchestrator assigns tasks, monitors completion, handles retries and escalation, and prevents abandoned work.
4. Where workload is high, independent subtasks may be delegated to helper agents with bounded budgets and concurrency; never create uncontrolled recursive agents.
5. Human intervention is reserved for policy-defined high-risk actions (financial exposure, contractual changes, access/security, production deployment, unusual cancellations/refunds). The owner retains production deployment approval.
6. All actions are tenant-scoped, audited, idempotent where necessary, observable, and recoverable. No confidential net prices, margins, platform fees or DMC identities in outward emails or AI prompts.

## Existing foundation to inspect, not overwrite
- server/ai/runtime.ts — runAgent, token budget, 8-step limit, audit and approval gate
- server/ai/model.ts — ModelClient and AnthropicClient
- server/ai/approvals.ts — decideApproval and approval handlers
- server/ai/notify.ts — importance classification
- server/ai/store.ts — pgRunStore
- server/mail/* — outbox, inbound webhook, inbox, platform addresses
- migration 032_ai.sql — ai_agents, ai_runs, ai_audit, approval_queue, approval_votes, notify_rules
These paths are historical project context; verify against CURRENT branch before asserting they exist or work.

## Required capabilities to evaluate
- Task lifecycle: queued → claimed → running → waiting_approval / retrying → succeeded / failed / escalated; durable persistence and restart recovery.
- Scheduling, fair queuing, worker leases/heartbeats, bounded concurrency, timeout handling, dead-letter processing and idempotency.
- Multi-agent delegation: supervisor/helper routing, scoped permissions, per-task budgets, loop prevention, shared context minimization.
- Incident response: detection, diagnosis, safe automatic remediation, validation, audit, escalation.
- Email automation: triage, drafting, policy-safe sending and human approval thresholds; keep DMC mail accounts/AI keys isolated from platform accounts unless explicitly configured.
- Financial safeguards: immutable price snapshots, approval thresholds, separation of duties, reconciliation, and exception queues.
- Code delivery: separate branches, isolated tests, CI checks, draft PRs; no autonomous merge or production deployment.
- Operator dashboard: task status, queue backlog, SLA, failures, cost, approvals, exceptions, CI/deploy status.
- Economics: rules-first routing, small models for narrow tasks, larger cloud models for complex tasks; no dependence on the owner's laptop being powered on.
- Security: tenant boundaries, secrets, prompt injection defenses, least privilege, redaction, replay resistance.

## Proposed measurable outcomes (targets, not observed results)
- Autonomous resolution rate by workflow and risk tier.
- Human touches per 100 reservations and per 100 support tickets.
- Exception queue aging and SLA compliance.
- Agent success / retry / escalation rates.
- Cost per resolved case (including inference and infrastructure).
- Wrong-action and rollback rates; financial reconciliation differences.
- Workload scaling: compare 1x, 3x, 10x transaction volume vs staffing and operational cost.
Do not claim fixed automation percentages without baselines and validation.

## Questions for Claude — please provide an independent critique
1. Inspect current branch and cite real file paths/lines and relevant commits. What is implemented, partial, missing, or risky?
2. Does the 8-step runAgent design reliably finish long tasks? Propose a safe continuation/checkpoint mechanism instead of unlimited loops.
3. How should helper agents be spawned only when useful, with concurrency, budget, isolation and stop conditions?
4. What should remain deterministic instead of AI-controlled, especially reservation, inventory, distribution, pricing and finance?
5. Which missing controls would prevent a small team from operating at 10x volume?
6. What are the top P0/P1/P2 gaps, dependencies, and smallest independent PRs to close them?
7. Propose a minimal KPI dashboard and acceptance tests, including failure injection and recovery drills.
8. Identify unnecessary complexity and propose a simpler architecture where possible.
9. Flag contradictions with existing specifications and owner decisions; do not silently rewrite them.

## Deliverable requested from Claude
Produce a review report with evidence-backed implementation status, architecture options and trade-offs, P0/P1/P2 roadmap, measurable acceptance criteria, and open owner decisions. Separate observed facts from recommendations. Do not implement or merge anything yet. Wait for explicit owner approval before development or deployment.
