# Code federation and shared Workflow Studio

Canonical architecture/status: https://github.com/rodverse/rodverse/tree/main/docs/module/federation

## Implemented (checkpoint, 2026-11-28)

- `packages/workflow-core` owns the orb-derived YAML CST parser/inspect/transform code. Unrelated fields and comments survive field edits and step wiring. Legacy Shell drafts are imported without deleting their original localStorage entry.
- `packages/workflow-studio` owns the single editor implementation. Scoped adapters supply routing, repositories, request transport, persistence and cancellation. orb consumes versioned pack artifacts instead of maintaining an editor fork.
- `apps/workflow` renders the same feature at `/workflow/` and as the `rod_code/App` remote. Only its standalone entry creates a TanStack Router/React root. React/DOM 19.2.4 are shared singletons. CSS, tokens and React Flow styles stay inside Shadow DOM; responsive panels use container queries.
- GitHub public metadata uses fixed public endpoints and no credentials. Privileged workflow execution remains behind orb's existing authorized transport. Manage does not provide that capability yet.
- Existing Shell preview/build workflow stages standalone and immutable `/modules/code/<sha>/` artifacts plus `/workflow/rod-module.json`. Two prior builds are retained within the same deployment lane for rollback. Existing Shell APIs, WASM and R2 paths remain.

## Verified locally

Core: 6 parser/patch/migration tests. Core, Studio and standalone TypeScript checks; Shell Go/WASM/frontend build and standalone/federated bundles completed. Existing orb API tests and web/typechecks passed before the final transport refresh.

## Pending verification

Real Code loading in Manage, URL/draft lifecycle, final shared-package consumption by orb, deployed preview/header/SHA checks, removal of the old prototype federation host after parity, and Safari. No successful deployment is claimed for this checkpoint. Public package publishing and privileged host adapters remain pending.
