import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config import HERMES_API_SERVER_URL

router = APIRouter(prefix="/auth", tags=["auth"])


class TokenRequest(BaseModel):
    token: str


@router.post("/verify")
async def verify_token(body: TokenRequest):
    if not body.token:
        raise HTTPException(status_code=401, detail="Token required")

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{HERMES_API_SERVER_URL}/v1/models",
                headers={"Authorization": f"Bearer {body.token}"},
            )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Hermes backend is unreachable. Start the backend and try again.",
        ) from exc

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid Hermes API key")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Hermes backend rejected the verification request")

    return {"ok": True, "message": "Token verified"}
