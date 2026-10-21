# FiduciaryOS Security Documentation

## Alpha Sleeve Sandboxing Architecture

The Alpha Sleeve is an optional, opt-in module for prediction market arbitrage. Because it executes real financial transactions with real money, it receives the most rigorous isolation treatment in the FiduciaryOS architecture.

---

## Threat Model

### Assets at Risk

1. **Client funds** — the Alpha Sleeve holds up to 5% of total portfolio AUM
2. **Client PII** — name, SSN, account numbers, contact information
3. **Core portfolio positions** — the main portfolio must not be influenced by Alpha Sleeve failures
4. **Signing keys** — the Policy Artifact signing private key must not be accessible to the Alpha Sleeve

### Threat Actors

| Actor | Capability | Mitigation |
|-------|-----------|------------|
| Compromised prediction market API | Malicious data injection via market feed | Input validation + anomaly detection on market data |
| Rogue model output | Alpha Sleeve model proposes violating action | Policy Artifact verification before every execution |
| Container escape | Attacker gains shell in Alpha Sleeve container | gVisor runtime + seccomp + no-privilege container |
| Network pivot | Alpha Sleeve used as pivot to reach core DB | Separate Docker network, no routing between Alpha and core |
| Supply chain compromise | Malicious pip package in Alpha Sleeve deps | Pinned dependencies + hash verification |

---

## Container Isolation Design

### Network Architecture

```
┌─────────────────────────────────────────────────────┐
│  Host Machine                                       │
│                                                     │
│  ┌─────────────────────┐    ┌─────────────────────┐ │
│  │  Core Network       │    │  Alpha Network      │ │
│  │  (core_net)         │    │  (alpha_net)        │ │
│  │                     │    │                     │ │
│  │  fiduciaryos-core ◄─┼────┼─► alpha-proxy       │ │
│  │  postgres           │    │       │             │ │
│  │  redis              │    │  alpha-sleeve ──────┼─┼──► Internet
│  │                     │    │       │             │ │    (Polymarket API)
│  └─────────────────────┘    └───────┼─────────────┘ │
│                                     │               │
│                              narrow API only        │
│                           (PnL report + HALT cmd)   │
└─────────────────────────────────────────────────────┘
```

### Docker Compose Network Separation

The Alpha Sleeve container:
- Is attached to `alpha_net` only — it has no route to `core_net`
- Has no access to the PostgreSQL database
- Has no access to the Redis cache
- Can only communicate with Core via the narrow alpha-proxy service

The alpha-proxy implements the only permitted message types:
- Core → Alpha: `HALT`, `UPDATE_POLICY`, `GET_STATUS`
- Alpha → Core: `POSITION_REPORT`, `DAILY_PNL`, `RISK_UTILIZATION`

All other messages are rejected at the proxy layer.

### Runtime Security

```yaml
# docker-compose.yml security configuration for Alpha Sleeve
alpha-sleeve:
  security_opt:
    - no-new-privileges:true
    - seccomp:deploy/seccomp-alpha.json
  runtime: runsc  # gVisor for kernel isolation
  read_only: true
  tmpfs:
    - /tmp:size=100m
  cap_drop:
    - ALL
  cap_add:
    - NET_BIND_SERVICE
  user: "1001:1001"
```

---

## Why External Skill Frameworks Are Explicitly Banned

FiduciaryOS explicitly prohibits integration with:
- **OpenClaw** (AI agent skill marketplace)
- **MCP (Model Context Protocol) plugins** of any kind
- **Composio** or similar external tool orchestration platforms
- **Any plugin system** that grants the model runtime access to external code

### Rationale

**The fiduciary duty argument**: A fiduciary advisor cannot delegate decision-making authority to an unvetted third party. If FiduciaryOS loads an external skill that executes a trade, the provenance of that decision is broken — we cannot audit who made it. The audit log loses its integrity.

**The security argument**: External skill marketplaces (like OpenClaw) allow third-party code to run within the model's execution context. In a financial system, this is equivalent to allowing an unknown contractor to execute trades in a client's brokerage account. The regulatory and liability exposure is unacceptable.

**The formal argument**: The signed Policy Artifact's integrity depends on the model having a fixed, audited capability set. If the model can dynamically extend its capabilities via external skills, the Policy Artifact cannot bound what the model can do. The policy enforcement guarantee fails.

### What is permitted

- Calling verified, audited, in-repo tools (the `core/` library)
- Fetching read-only market data from approved API providers
- Writing to the cryptographically-signed audit log
- Proposing actions that are then verified against the Policy Artifact

### What is not permitted

- Executing any tool not in the `/fiduciaryos/core/` or `/fiduciaryos/agents/` directories
- Loading plugins at runtime from any source
- Executing code received from external APIs (no eval, no exec, no importlib from network)
- Bypassing the Policy Artifact verification step

This restriction applies to both the core FiduciaryOS model and the sandboxed Alpha Sleeve.

---

## Policy Artifact Cryptographic Design

The Policy Artifact is signed with RSA-4096. The signing private key:
- Is generated once at client onboarding
- Is stored in a hardware security module (HSM) in production
- Is never accessible to the FiduciaryOS model or the Alpha Sleeve
- Signs the SHA-256 hash of the canonical JSON policy document

Before executing any action, the Policy Enforcement Layer:
1. Retrieves the current Policy Artifact from secure storage
2. Verifies the RSA-4096 signature against the stored public key
3. Checks the action against all policy constraints
4. Logs the policy check result (including the artifact hash)
5. Only then permits or denies the action

A compromised Policy Artifact (tampered without re-signing) will fail signature verification and trigger an automatic halt.

---

## Incident Response

### Alpha Sleeve Emergency Halt

If an anomaly is detected in the Alpha Sleeve (unexpected position size, unusual API calls, model output anomaly):

```bash
# Immediate halt of Alpha Sleeve
docker exec fiduciaryos-core python -c "
from core.risk_guardian import RiskGuardian
guard = RiskGuardian()
guard.halt_alpha_sleeve(reason='manual_emergency_halt')
"
# This sends HALT signal via alpha-proxy and closes all Alpha positions
```

### Safe Mode Activation

```bash
# Move all portfolio to cash equivalents
docker exec fiduciaryos-core python -c "
from core.risk_guardian import RiskGuardian
guard = RiskGuardian()
guard.activate_safe_mode(client_id='client_001', reason='manual_emergency')
"
```

---

## Responsible Disclosure

Security vulnerabilities should be reported to: security@fiduciaryos.ai (or open a GitHub Security Advisory).

Do not open public GitHub issues for security vulnerabilities involving the Alpha Sleeve, signing key management, or policy enforcement bypass.

---

## Regulatory Compliance Notes

FiduciaryOS is designed to be compliant with:
- **SEC Rule 206(4)-7**: Investment Adviser Compliance Programs
- **FINRA Rule 4370**: Business Continuity Plans and Emergency Contact Information (audit trail)
- **Reg BI (Best Interest)**: The Policy Compiler implements the best-interest analysis required by Reg BI for broker-dealers serving retail customers

FiduciaryOS is research software and is not a registered investment adviser. Deployment in production for actual client management requires SEC registration and compliance review.
