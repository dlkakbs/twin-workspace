from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.auth import router as auth_router
from routes.profile import router as profile_router
from routes.delegations import router as delegations_router
from routes.calls import router as calls_router
from routes.settings import router as settings_router
from routes.twilio import router as twilio_router
from routes.video import router as video_router
import twin_bridge

app = FastAPI(title="Twin Workspace API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(profile_router)
app.include_router(delegations_router)
app.include_router(calls_router)
app.include_router(settings_router)
app.include_router(twilio_router)
app.include_router(video_router)


@app.on_event("startup")
def _startup() -> None:
    twin_bridge.start_cron_ticker()


@app.on_event("shutdown")
def _shutdown() -> None:
    twin_bridge.stop_cron_ticker()


@app.get("/health")
def health():
    return {"status": "ok", "service": "twin-workspace-api"}
