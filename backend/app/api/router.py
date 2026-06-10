from fastapi import APIRouter

from app.api.routes import auth, clients, llm_configs, settings, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(llm_configs.router)
api_router.include_router(settings.router)
api_router.include_router(clients.router)
