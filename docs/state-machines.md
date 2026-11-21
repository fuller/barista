# Voice and ordering state machines

The client uses XState 5 and `@xstate/react`. The executable definitions are [ordering-machine.ts](../src/application/ordering-machine.ts) and [voice-preparation.machine.ts](../src/application/voice-preparation.machine.ts).

## Ownership

The ordering actor gates input on an explicit store selection and owns the committed cart, pending clarification, conversation, errors, metrics, draft transcript and preview. React subscribes through [use-ordering.ts](../src/ui/use-ordering.ts); loading and listening indicators come from machine tags. React keeps input text, connection fetching, media-query/dialog state, and DOM refs.

The root callback actor creates the native speech input/output and preparation machine. Its cleanup disposes those resources, clears timers, cancels owned work and invalidates timing. Each final submission runs in a promise actor: leaving `submitting` aborts its transport and ignores late completion. Manual edits, new microphone sessions and replacement submissions invalidate old work.

The order domain still validates immutable commands. Model confidence, coverage and complete-order validation remain on the server. Pricing still runs independently through TanStack Query and the browser pricing service.

## Ordering states

| State | Meaning |
| --- | --- |
| `idle` | Ready for typed input, microphone input or manual changes. |
| `listening.capturing` | Accepting speech; no speculative request currently pending. |
| `listening.preparing` | One speculative interpretation is pending. |
| `listening.preview` | A hypothetical result is available; the cart is unchanged. |
| `submitting` | Waiting for the final typed/spoken turn, including adopted prepared work. |
| `settled` | Immediate routing after accepting a response. |
| `clarifying` | A revision-bound pending question exists. Retry prompts without a pending slot return to `idle`. |
| `failed` | The turn failed; cart contents remain unchanged and new input is allowed. |

`busy` tags `submitting`; `listening` tags the listening parent; `preparing` tags its preparing child. These modes are not duplicated as React state.

## Main events

| Events | Effect |
| --- | --- |
| `STORE.CHANGED` | Cancel requests, speech and clarification; retain the cart and set the selected store. |
| `ORDER.SUBMIT`, `VOICE.FINAL` | Validate input and start or adopt a final request. |
| `VOICE.START`, `VOICE.INTERIM`, `VOICE.FINISH`, `VOICE.ERROR` | Coordinate a native recognition session and its draft. Finishing preserves final-result eligibility. |
| `ORDER.COMMIT`, `ORDER.RESET` | Apply valid manual changes and invalidate older work. |
| `REQUEST.CANCEL`, `CLARIFICATION.CANCEL` | Cancel owned work; question cancellation also clears its pending slot. |
| `CONNECTION.CHANGED`, `REPLIES.CHANGED` | Update external connection availability or speech preference. |
| `UI.LAYOUT_COMMITTED`, `UI.FRAME_PAINTED` | Publish local timing only for the matching turn and committed cart revision. |

## Preparation and request ownership

Preparation moves through `idle`, `waiting`, `debouncing`, `pending`, `ready`, `failed`, and `invalidated`. Unchanged trimmed interim text keeps its original 650 ms debounce deadline. Corrections before dispatch restart that timer. Each microphone session allows at most two preparation attempts, with one active candidate. After dispatch, changed interim text aborts the stale candidate and restarts the 650 ms debounce if one attempt remains. Withdrawn or oversized text clears the candidate and waits for valid text. After both attempts are spent, further changes enter `invalidated` until a new microphone session begins. A mismatched or failed preparation can still use one ordinary final request, for at most three HTTP turns per session.

Only an exact trimmed final transcript with the same cart revision can take pending or ready work. Taking returns the original turn ID, promise and abort controller, then resets preparation to `idle`. The final submission owns those resources from that point, so preparation cleanup cannot abort adopted work. A failure observed before adoption allows an ordinary final request. Failure after adoption is reported without an automatic retry.

Final responses must match the submitted turn ID and base revision. Commands are validated before committing. Cancelled or superseded invocations cannot commit a cart, publish a preview/timing sample, or speak an acknowledgement.

## Lifetime and testing

Actors are local in-memory state. Promises, abort controllers and native resources are not durable cart persistence. OpenRouter receives explicit context on every call; the actors do not create a model-side session.

Transition tests cover cleanup, request budgets, correlation and failure paths. Browser tests exercise React Strict Mode and native timer binding. See [testing](testing.md) for commands and coverage.
