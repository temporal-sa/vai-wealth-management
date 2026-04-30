import json
import os
from dataclasses import asdict
from enum import Enum
from typing import Any, Dict, List, Union

import redis.asyncio as redis

from .user_message import ChatInteraction
from .status_update import StatusUpdate


class EventType(str, Enum):
    CHAT_INTERACTION = "chat_interaction"
    STATUS_UPDATE = "status_update"


class EventStreamManager:
    def __init__(self, redis_host: str = None, redis_port: int = None):
        self.redis_host = redis_host or os.getenv("REDIS_HOST", "localhost")
        self.redis_port = redis_port or int(os.getenv("REDIS_PORT", "6379"))
        self.redis_client = redis.Redis(
            host=self.redis_host,
            port=self.redis_port,
            decode_responses=True,
        )

    def _stream_key(self, workflow_id: str) -> str:
        return f"events:{workflow_id}"

    async def append_chat_interaction(self, workflow_id: str, chat_interaction: ChatInteraction) -> int:
        return await self._append(workflow_id, EventType.CHAT_INTERACTION, chat_interaction)

    async def append_status_update(self, workflow_id: str, status_update: StatusUpdate) -> int:
        return await self._append(workflow_id, EventType.STATUS_UPDATE, status_update)

    async def _append(self, workflow_id: str, event_type: EventType, obj: Union[ChatInteraction, StatusUpdate]) -> int:
        event = {"type": event_type.value, "content": asdict(obj)}
        return await self.redis_client.rpush(self._stream_key(workflow_id), json.dumps(event))

    async def get_events_from_index(self, workflow_id: str, from_index: int = 0) -> List[Dict[str, Any]]:
        raw = await self.redis_client.lrange(self._stream_key(workflow_id), from_index, -1)
        events = []
        for item in raw:
            try:
                events.append(json.loads(item))
            except json.JSONDecodeError:
                continue
        return events

    async def delete_stream(self, workflow_id: str) -> bool:
        deleted = await self.redis_client.delete(self._stream_key(workflow_id))
        return deleted > 0

    async def close(self):
        await self.redis_client.aclose()
