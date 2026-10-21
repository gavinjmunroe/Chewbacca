# Decision: Knowledge Base Architecture

**Date**: April 8, 2026
**Participants**: Caleb Newton, Sagar Tiwari, Karthik, Aveneel

## Context
Amber needs a centralized knowledge base for company/project data (BMA, Rytual) that all agents can query. Inspired by Karpathy's LLM Knowledge Bases pattern.

## Decision
- Create `amber-knowledge-base` repo on GitHub (private)
- Structure: `raw/` for source data, `wiki/` for LLM-compiled articles
- NO personal data in this repo. Only company/project/product data.
- PII stays in decentralized instances (each person's Amber app)
- Sagar to provide BMA PPTs/PDFs and Rytual videos for ingestion
- Karthik and Avi to hash out architecture on their call
- Start with Sagar's local data, no personal data initially

## Privacy Rules
- Enterprise data (BMA, Rytual) is separate from personal data
- Each person's Amber is a decentralized instance with protected PII
- Selective opt-in sharing between instances
- "The girl's app has to be a decentralized instance of memory that is protected"
