"""AES-256-GCM encryption for secrets stored in the database (LLM API keys).

The PRD (§10.2) requires API keys to be stored encrypted, never in plain text.
The 256-bit key is derived from APP_ENCRYPTION_KEY via SHA-256.
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

_NONCE_SIZE = 12


def _key() -> bytes:
    return hashlib.sha256(get_settings().app_encryption_key.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    nonce = os.urandom(_NONCE_SIZE)
    ciphertext = AESGCM(_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_secret(token: str) -> str:
    if not token:
        return ""
    raw = base64.b64decode(token)
    nonce, ciphertext = raw[:_NONCE_SIZE], raw[_NONCE_SIZE:]
    return AESGCM(_key()).decrypt(nonce, ciphertext, None).decode("utf-8")


def mask_secret(plaintext: str) -> str:
    """Return a display-safe hint like 'sk-a…WAAA' without revealing the key."""
    if not plaintext:
        return ""
    if len(plaintext) <= 8:
        return "•" * len(plaintext)
    return f"{plaintext[:4]}…{plaintext[-4:]}"
