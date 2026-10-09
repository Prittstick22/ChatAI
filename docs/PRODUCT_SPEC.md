# Product requirements — ChatAI v1

## Pitch
**The group chat that organises itself.** Participants communicate normally, while embedded AI reveals missed decisions, finds context semantically and offers optional actions. This is *not* a prompt-first AI chatbot.

## Target demo
Four students organising a society hackathon. A realistic 25–40 message fixture contains a proposed meeting time, agreement, a venue, competing food choices and tasks. Two browser sessions impersonate demo users (no auth). Chat is real and updates without reload.

## Priorities and evidence
| Feature | Priority | Must demonstrably work |
|---|---|---|
| Base group chat | P0 | Send in tab A, see in tab B without reload, persist on refresh |
| Catch-up | P0 | 20+ messages grouped into topics, decisions, open questions; no invented facts |
| Search | P0 | Query like "when are we meeting" finds a differently worded relevant message and shows the source |
| Event suggestion | P0 | Detect a candidate date/time and present an **unconfirmed** proposal |
| Calendar ICS | P0 | User explicitly approves, then downloads meaningful .ics with confirmed date/time |
| Polls | P1 | User may accept a suggested poll and vote on options; show results if feasible |
| Smart replies | P2 | Optional click-to-fill short response suggestions |
| Accounts, push notifications, multi-room permissions | OUT | Demo identities only |

## User journeys
1. Select Alex in browser A and Sam in browser B; type a message in A; both render it; refresh and verify history.
2. Return to chat and click Catch up; see topics, decisions, action items and unknowns distinguished.
3. Search by meaning; open/identify original message and author, never fabricate source.
4. AI notices "Saturday 12:00" and suggests a meeting **only if a resolvable timestamp**. User can dismiss or confirm. Do not silently add calendar entries.
5. For undecided options, offer a poll suggestion; accept before persistence.
6. Simulate AI outage: chat still sends and receives; intelligence shows graceful error/fallback.

## Functional rules and non-goals
- Single demo room `demo` is acceptable, 100 newest messages maximum.
- Display chronological messages; deduplicate WebSocket and HTTP POST results by message ID.
- Minimal reconnect on WS close; do not store authentication passwords or personal data.
- Timezone: Europe/London for interpreting event proposals; **never guess ambiguous dates**. ICS uses UTC with explicitly converted time; otherwise request confirmation.
- Avoid automatic action execution; AI only suggests.
- If embeddings unavailable, labelled keyword fallback is acceptable but NOT claim semantic mode.
- Context for missed summaries is recent chat history, not unread cursor tracking. Label it "conversation catch-up", not precise unread summarisation unless cursor support added.

## Success cut line
If time is short, demonstrate live chat + catch-up + one user-approved action. P2 features are cut first. Working local demo takes priority over Vercel/Railway.
