"""Extension point for the Invisible AI nudge pipeline. Nothing is implemented yet.

main.post_message schedules after_message() as a background task once a message
is saved and broadcast, so it never delays sending. Errors are logged and dropped:
chat must keep working when the AI service is slow or down.
"""

from realtime import Hub


async def after_message(message: dict, hub: Hub) -> None:
    """Planned flow:

    1. Debounce per room (about 3 s of quiet) so a burst of messages is analysed once.
    2. Send store.recent_for_ai(room) to the AI service, e.g. POST /suggest returning
       structured `proposals` (docs/CONTRACT_V1.md).
    3. Validate each proposal, then push it to the room's clients:
           await hub.broadcast({"type": "nudge", "room": room, "nudge": proposal}, room=room)
       The web client collects these and renders them inline in the conversation.

    The AI never writes to the database; a person approves any poll or event.
    """
    return None
