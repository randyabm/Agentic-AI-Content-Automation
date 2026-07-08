from fastapi import APIRouter

from app.api.routes import (
    articles,
    auth,
    campaigns,
    channels,
    clients,
    competitors,
    integrations,
    llm_configs,
    media,
    notifications,
    oauth_callback,
    orgs,
    scheduling,
    settings,
    style_cards,
    users,
    webhooks,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(oauth_callback.router)
api_router.include_router(users.router)
api_router.include_router(users.team_router)
api_router.include_router(orgs.router)
api_router.include_router(integrations.router)
api_router.include_router(channels.router)
api_router.include_router(scheduling.router)
api_router.include_router(notifications.router)
api_router.include_router(media.router)
api_router.include_router(webhooks.router)
api_router.include_router(llm_configs.router)
api_router.include_router(settings.router)
api_router.include_router(style_cards.router)
api_router.include_router(clients.router)
api_router.include_router(competitors.router)
api_router.include_router(articles.router)
api_router.include_router(articles.sources_router)
api_router.include_router(campaigns.router)
