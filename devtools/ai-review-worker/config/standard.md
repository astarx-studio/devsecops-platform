# Review standard (default)

Edit this file to change what the reviewer treats as a blocker, a potential bug, or a recommendation. Changes apply to the next review without a restart. A project can add its own rules with `standard.extra_standard_files` in `review.yaml`.

A finding **MUST** be supportable as: when a reachable input happens, this code does a wrong outcome, because of a reason in the diff, the code that was read, or a linked Qestor item. If that sentence cannot be finished, the finding **MUST NOT** be posted. Empty arrays are the correct result for a sound change.

## Always a blocker

- Secrets, tokens, passwords or private keys committed in code or config.
- Code that cannot compile or parse, or imports a symbol that does not exist.
- SQL, shell or HTML built from user input without escaping or parameters.
- Auth or permission checks removed or bypassed.
- Data loss: destructive migrations without a down path, deletes without a filter.
- An obvious crash on the main path, such as a null access on a value the diff itself makes optional.
- A business rule the linked item or the diff itself states, which this change violates: a wrong amount, a wrong status, the wrong audience, or an action the item says must be allowed or refused.

## Usually a potential bug

A potential bug is the same kind of wrong outcome when the path is likely but not fully proven. It still blocks approval. The text **MUST** name the input, the wrong result, and why that input is reached by this change.

- Error paths that are swallowed, or a promise without `await` or `.catch`, where that path produces a wrong result.
- Off-by-one errors, wrong comparison operators, inverted conditions.
- Shared state changed without locking, or races between async steps, where the race changes a result.
- Behavior changed for an existing caller that this diff or the related code shows, without updating that caller.
- New user-facing strings that bypass the project's i18n catalogs on a screen this change renders.

## Recommendations, never blocking

A recommendation **MUST** be a concrete change that prevents a real technical or business miss and is not already a bug. Tests **MUST** be recommended only when new logic has no check for a rule the item or the diff states.

## Linked Qestor items

`done` **MUST** mean the diff meets every stated requirement in the item transcript. The transcript is the description, the custom fields, and the comments from oldest to newest. A later comment overrides an earlier statement when they conflict. Use the latest statement of each requirement.

A commit or a changed file that only mentions the item id **MUST NOT** count as done. The explanation **MUST** say which requirement is met or missed.

`partial` or `missing` **MUST** be used when a stated requirement is absent or contradicted. `done` **MUST** be used only when each requirement that belongs on this side of a split `[FE]` / `[BE]` item is met.

## Not worth reporting

- "Consider", "it would be good to verify", "might", or "may if used somewhere else", including a component that might fail if used standalone when no such caller exists.
- Missing comments, naming, duplication, or extra tests that only increase confidence.
- A business rule the item and the code do not state.
- Pure formatting the project's formatter would fix.
- Personal style preferences with no effect on behavior.
