from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel


class ProcessUserMessageInput(BaseModel):
    user_input: str


@dataclass
class ChatInteraction:
    user_prompt: str
    text_response: str
    json_response: Optional[str] = None
    agent_trace: Optional[str] = None
