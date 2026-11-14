# BED4BOOK — OpenHands / Railway Handover Report
Date: 2026-11-13
Audience: Claude Code / BED4BOOK technical owner
Scope: Documentation only. This report does not authorize code changes, deployment, credential rotation, or integration changes.

## 1. Why this environment exists
The product owner wants an AI development orchestration environment for BED4BOOK: multiple AI coding agents (Claude Code, OpenAI Codex, Gemini CLI, and other compatible providers) working on separate tasks/branches, with a central queue and automatic fallback when a provider's permitted quota is exhausted. When limits renew, eligible agents should return to the pool. The objective is to minimize human configuration and ongoing cost, preferring free quotas where permitted and otherwise the lowest practical paid usage. Never assume a ChatGPT/Claude consumer subscription includes API credits.

BED4BOOK safety rules: no autonomous merge or production deployment; explicit product-owner approval is required. Keep agent work isolated by branch/PR; run tests and CI. Do not expose secrets, cross-tenant data, supplier identities, net prices or margins to unrelated agents. Provider usage must comply with provider terms; no circumventing quotas.

## 2. Deployment verified (Railway connector)
Project: refreshing-enjoyment
Project ID: d453c518-ea1e-440d-bd36-c0f385c127de
Environment: production
Environment ID: 58f4697e-583e-43c2-ab29-4b3bbe014015
Service: OpenHands
Service ID: 344e1255-85f6-4073-a8f0-f2aba614067b
Public URL: https://openhands-production-7511ec05.up.railway.app/
Agent Canvas URL: https://openhands-production-7511ec05.up.railway.app/canvas/
Deployment ID: 15859690-cad5-4cc7-b8fe-bf89dce8394e
Deployment status: SUCCESS as verified 2026-11-13; one running replica, zero crashes, /health HTTP 200 in startup logs.
Source: dektionstudio/railway-template-images, branch main, commit 8bce703b356dbc1282bf4439bbbfa39a6cf403a3, root /openhands.
Volume: openhands-volume, 5000 MB, mounted at /home/openhands.
Port: 8000 externally; automation service startup logged at 18001.
Railway variable names observed (values not read or included): AUTOMATION_BASE_URL, CANVAS_URL, LOCAL_BACKEND_API_KEY, OH_SECRET_KEY, PORT.

Build logs indicated installation of @anthropic-ai/claude-code and @openai/codex global packages; npm warned that the Claude Code postinstall script was not run due to npm allowScripts policy. This does NOT prove either CLI is authenticated or functional. Gemini CLI was visible in the UI's agent list but its binary/install/authentication has NOT been verified.

Deployment logs:
- Application startup complete.
- [agent-canvas] Automation Server is ready on port 18001.
- [agent-canvas] All services started; unified entry point http://0.0.0.0:8000/.
- Security warning: public bind host (::) means the app refused to inject session API key into HTML; UI requests an API key instead. Do not weaken this safeguard.
- Workspace retention warning: automation-runs path did not exist at startup; no purge performed. Investigate before relying on retention.

## 3. What happened in the user setup
The product owner deployed the Railway OpenHands template; the assistant inspected Railway status/logs and guided the owner through browser onboarding. The owner opened /canvas/, saw 'Add a backend', entered the Railway backend API key (not shared in chat), then reached 'Choose your agent'. Available UI choices shown: OpenHands, Claude Code, Codex, Gemini CLI. OpenHands was kept selected. Next screen: 'Set up your LLM' with API key authentication, OpenAI provider, and a preselected gpt-5.6-sol model. Dropdown also displayed gpt-5.3-codex, gpt-5.2-codex, gpt-oss-120b, gpt-oss-20b, among others. No LLM provider credentials or successful model inference were verified. An earlier suggestion to try gpt-oss-20b was speculative and must NOT be treated as a validated cheapest or best model. Confirm actual supported provider, per-token price, model capability and deployment availability.

The user expressed dissatisfaction at being asked to perform many manual steps. They explicitly stopped further development by this assistant and requested that Claude take over. This report is the sole authorized repository change in this handoff.

## 4. What was and was not done by the assistant
DONE: Inspected Railway deployment/service config, health and logs; provided UI navigation instructions; confirmed the user's screenshots reached the model-setup screen; prepared this handoff document.
NOT DONE: No AI provider account authentication by the assistant; no Claude/Codex/Gemini agent integration, orchestration service, quota monitor, queue, GitHub repo integration, pricing validation, code development or production changes to OpenHands/BED4BOOK. No API keys are included here. Do not claim that an orchestrator is already running.
The Railway connector permits service configuration and variable management but does not itself offer direct interaction with the user's Safari session or arbitrary application UI. Investigate supported OpenHands APIs/automation endpoints and/or an authorized computer-use runtime before promising full automation.

## 5. Recommended next steps for Claude (analysis first, no automatic deployment)
1. Verify external Canvas login/backend authentication and current setup state without exposing credentials. Confirm whether the public endpoint has adequate access controls; assess security before connecting GitHub or adding agent keys.
2. Inspect OpenHands Agent Canvas documentation and its actual automation API, supported agent adapters and provider authentication methods. Distinguish 'visible in selector' from 'installed, authenticated and working'.
3. Validate Claude Code and Codex CLI functionality (including npm postinstall warning); check Gemini CLI availability. Never request secrets in a public chat or commit them.
4. Compare actual provider pricing, free/API allowances, quotas and terms. Set explicit per-provider spending limits; do not assume API quotas can be queried or reset automatically. Handle 429/rate limits with backoff; checkpoint jobs; prevent duplicate side effects on handoff.
5. Propose an implementation for a persistent job queue, provider health/quota status, capability-based routing, budget guardrails, fallback/retry and resumption after quota renewal. Identify which parts OpenHands supports natively and which need custom development.
6. Prepare GitHub integration with least privilege to kosker-07/Book4me, isolated branches and PRs, automated CI; preserve owner approval gates for merge and production deploy.
7. Report the proposed architecture, costs, risks and minimal owner-only actions before implementing. The product owner asked Claude to take over; this document is not blanket permission to deploy or modify BED4BOOK production.

## 6. Notes
- The separate former Cezar service was removed in an earlier experiment; do not confuse its retained volume with the new OpenHands volume.
- The user prefers a system that actually performs work, not a long sequence of manual screenshots and setup steps.
- Do not alter the existing BED4BOOK app, contracts, data model or production environments as part of reviewing this report.
