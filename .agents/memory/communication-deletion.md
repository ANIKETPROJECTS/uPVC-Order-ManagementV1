---
name: Communication deletion semantics
description: User intent for deleting conversations and messages in UPVC Communication.
---

Deleting a conversation means hiding it only from the signed-in user's Communication list while preserving the other participant's history. New activity can make the conversation visible again. It does not revoke login sessions or deactivate the other user. Deleting an individual message applies to everyone in the conversation.

**Why:** The user clarified that “delete user session” meant removing the whole conversation/person from their Communication list for now, not changing authentication sessions. They selected global deletion for individual messages.

**How to apply:** Keep conversation removal user-scoped and reversible through new activity or reopening a direct chat. Keep message deletion global, and do not infer account or session deletion from chat actions.