"""WebSocket connection manager — tracks live clients per job_id."""
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, ws: WebSocket, job_id: int) -> None:
        await ws.accept()
        self._connections[job_id].add(ws)

    def disconnect(self, ws: WebSocket, job_id: int) -> None:
        self._connections[job_id].discard(ws)

    async def broadcast(self, job_id: int, data: dict) -> None:
        dead: set[WebSocket] = set()
        for ws in set(self._connections.get(job_id, set())):
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections[job_id].discard(ws)

    def subscriber_count(self, job_id: int) -> int:
        return len(self._connections.get(job_id, set()))


manager = ConnectionManager()
