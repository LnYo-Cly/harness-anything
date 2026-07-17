# Aurora Commerce Demo

This checked-in project is a realistic Harness product portfolio for exploring the GUI and the Task–Decision–Fact model. It contains no private project data or generated `.harness/` cache.

## Open it in the GUI

From this directory, launch the desktop app:

```bash
cd examples/minimal-project
harness-anything gui
```

Then open this folder if the project picker appears. The dashboard should show:

- **40 Tasks** — 6 active, 3 blocked, and 31 planned across five product lines.
- **5 Decisions** — proposed choices for express checkout, wallets, inventory, performance, and grounded AI.
- **10 Facts** — funnel, usability, payment, inventory, performance, catalog, and carrier observations.
- **11 Relations** — evidence and derivation edges forming five visible decision clusters.

The portfolio is intentionally coherent. Aurora Commerce is evolving checkout and growth, payments and trust, fulfillment, quality and platform, and AI shopping experiences. The active and blocked work is backed by concrete observations, while the five Decisions preserve the load-bearing product choices behind the roadmap.

## Make a writable copy

The ledger is committed here so GitHub visitors can inspect it. Harness normally keeps `harness/` in its own private nested Git repository, so copy the example before experimenting with writes:

```bash
cp -R examples/minimal-project ~/aurora-commerce-demo
cd ~/aurora-commerce-demo
git init
git -C harness init
git -C harness add .
git -C harness commit -m "chore: seed Aurora Commerce demo"
harness-anything gui
```

Do not commit `.harness/`; it is generated local state.
