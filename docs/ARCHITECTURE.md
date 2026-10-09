# System architecture

Use a **two-service backend**, not separate microservices for every feature: chat must remain functional if AI errors or times out.

```mermaid
flowchart TD
  UI[React TypeScript / WebSocket UI] -->|REST + WS| CHAT[FastAPI chat API]
  CHAT --> DB[(SQLite persistent data)]
  CHAT -->|HTTP with timeout| AI[FastAPI AI service]
  AI --> OPENAI[OpenAI completions and embeddings]
  CHAT -->|ICS export| CAL[Calendar client]
```

## Code ownership
- `apps/chat-api/`: HTTP and WS endpoints, message/poll/event storage, AI client fallback. **Owner A**
- `apps/ai-service/`: summarise topics, semantic similarity, detect meetings/options. **Owner B**
- `apps/web/`: presentation, local demo persona, message subscriptions, insights. **Owner C**
- `docs/` and `scripts/`: smoke tests, demo and release. **Owner D**

## Class / domain model
```mermaid
classDiagram
  class User { +string id; +string display_name }
  class ChatRoom { +string id; +string title }
  class Message { +int id; +string room_id; +string user_id; +string text; +datetime created_at }
  class Poll { +int id; +string question; +json options }
  class Vote { +int poll_id; +string user_id; +int choice_index }
  class Insight { +string kind; +string room_id; +string content }
  ChatRoom "1" --> "*" Message
  User "1" --> "*" Message
  ChatRoom "1" --> "*" Poll
  Poll "1" --> "*" Vote
  ChatRoom "1" --> "*" Insight
```

## Message flow
```mermaid
sequenceDiagram
 participant U as React client
 participant C as Chat API
 participant D as SQLite
 participant A as AI API
 U->>C: POST message
 C->>D: Save message
 C-->>U: 201 saved message
 C-->>U: Broadcast over WebSocket
 U->>C: GET insight/catch-up
 C->>D: Recent room messages
 C->>A: Request structured summary
 alt AI service available
 A-->>C: Topics, actions, event candidates
 else AI offline
 C-->>U: Degraded fallback summary
 end
 C-->>U: Insight result
```

## Intelligent nudges
```mermaid
flowchart TD
 M[New messages] --> T{Is a date, decision or option detected?}
 T -->|No| Q[Keep chatting]
 T -->|Yes| S[Show unobtrusive suggestion card]
 S --> A{User approves?}
 A -->|No| Q
 A -->|Yes, event| I[Download ICS calendar event]
 A -->|Yes, poll| P[Create poll and accept votes]
```

## Data/security and scalability
SQLite is sufficient for the single demo instance; use PostgreSQL for multi-node production. In-memory WebSocket registries only broadcast to clients connected to the same chat instance; use Redis Pub/Sub at scale. Currently no secure identity, rate limits, tenant isolation or message encryption. Store no private data in demo chats. Make external AI calls timeout/fail gracefully.
