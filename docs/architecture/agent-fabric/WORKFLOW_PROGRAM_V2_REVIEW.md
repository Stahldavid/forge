# Independent review of the workflow program v2 alpha

Reviewer: review_workflow_plan_v2, read-only, 2026-10-07.

The reviewer found no remaining blocker in the bounded alpha scope after iterative
counterexample-driven fixes. Independently closed findings include immutable receipts,
exact candidate/reviewer/check binding, persisted repair budgets, child inputs, output
schemas, obsolete additive gates, rejection masked by later values, late uncertainty,
item contributions omitted from final candidates, retired branch ledgers and cumulative
static-binding allocation. It ran 50 tests and then 6 focused tests with zero failures.
The final capacity-wait delta was read and approved: rechecking in a while loop before
incrementing prevents a woken waiter from taking a slot already consumed by another run.

The actual saved SDK proof was inspected without another model call: one readonly typed
attempt completed and the source was unchanged. Three saved benchmark runs were inspected:
82 calls/80 results, 78 retained successes, significant durable-state overhead. No actual
Claude run or product superiority was established.

SHA256 of reviewed implementation files:

| File | SHA256 |
| --- | --- |
| program-service.ts | 2A243A007EEB3999BF259C05FEF8FB441088F5674F5464EF21A5FC9CDAA97C71 |
| program-store.ts | D6B28573D5FE6BE8BDAF805B2CF6FB9AAE4F28E46E8753FA4A1C75EF7BB7CA65 |
| program-dsl.ts | C6F642B805717B4233CB2ADE2C6AB07FCCFA22CB7DD5F77BA35EEC677F02CD5A |
| program-types.ts | 924516CFED9F89F22869C4D545F636E22C6E63E479D64932A53583F1BD151401 |
| program-contract.ts | 866CD439DC8E50639D7C226BD0F3DE15D01C5FD1266B3721732AC8B350834CD5 |
| program-worker.ts | 7D5B596618D633F6A3683A39BAE68C455678E54E5317C4AB73C8EB6E66A07A93 |
| codex-sdk-worker.ts | B9C8E42C4222BC306BEDB824865DAC90C496A2C905A4CA48150C797B4D1A78AA |

This review supports the documented opt-in foundation. It does not certify full F6/F7,
independent live branch scheduling, semantic inventory, extensible recipes, maximum
scale, filesystem power-loss durability or production/human acceptance.
