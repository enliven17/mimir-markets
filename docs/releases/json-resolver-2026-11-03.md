# Generic JSON settlement rules disabled

Free-form creation remains available. A legacy JSON rule in a resolution URL or settlement-rule line is still parsed for compatibility, but its field/comparison can no longer authorize an automatic settlement proposal, even on an approved source host. A source being trustworthy does not establish that the chosen field answers the written question.

The oracle follows the existing process for the original question. Evidence fetching and both oracle/council prompts already strip the resolver fragment; the full original URL remains in the verdict audit record. Supported price, native sports and bound Polymarket routes retain their behavior. Source/model outages retain existing deferral/refund handling. Proposal, dispute and payout contracts are unchanged.

The preview helper no longer advertises automatic JSON settlement. Active creation and staking forms show a notice for URLs carrying parsed JSON rules. It says the custom comparison is ignored, with the original question evaluated through normal source checks and agent evaluation where needed. It does not promise a model call for a question already supported by another automatic route.

This change is source-only; no deployment was performed. Existing on-chain proposals or cached decisions are not invalidated by a source update. With no current deployment reported, there is no live migration in this task. Do not reuse pre-fix JSON-derived cached decisions in a future rollout.

Agent review is part of the intended design, but the current Convex settlement worker passes `jury: null`. It therefore does not guarantee a second agent evaluates every result. Optional council settlement uses a majority/confidence policy; one dissent is not an automatic veto, below quorum falls back to the solo oracle, and self-resolving mode uses the reference oracle verdict. These policies are documented here and were not changed by disabling the JSON shortcut.
