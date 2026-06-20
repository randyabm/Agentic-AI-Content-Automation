#!/usr/bin/env python3
"""
Direct test of Facebook publishing flow.
Run inside the app container to access secrets and DB.
"""
import sys
import os
sys.path.insert(0, '/code')
os.environ.setdefault('ENV', 'production')

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.social import SocialAccount
from app.models.campaign import Post, CampaignElement
from app.services.media_links import public_media_url
from app.services.direct_social import decrypt_secret
from app.services.publishing import compose_text, resolve_image, _image_key
import httpx
from sqlalchemy import select

db = SessionLocal()
settings = get_settings()

# Get first post with image
stmt = select(Post).limit(1)
post = db.scalars(stmt).first()
if not post:
    print("❌ No posts found")
    sys.exit(1)

print(f"Post: {post.id}")
print(f"  Headline: {post.headline}")

# Get campaign element and image
element = db.get(CampaignElement, post.element_id)
if not element:
    print("❌ No element found")
    sys.exit(1)

# Resolve image
image = resolve_image(db, post)
if not image:
    print("❌ No image found")
    sys.exit(1)

image_key = _image_key(image)
print(f"Image key: {image_key}")

# Generate signed URL
signed_url = public_media_url(image_key)
print(f"Signed URL: {signed_url}")

# Test URL access
print("\n🔍 Testing URL access...")
try:
    r = httpx.get(signed_url, timeout=10, follow_redirects=True)
    print(f"  Status: {r.status_code}")
    print(f"  Content-Type: {r.headers.get('content-type')}")
    print(f"  Content-Length: {len(r.content)} bytes")
    if r.status_code == 200:
        print("  ✅ URL is accessible")
    else:
        print(f"  ❌ URL returned {r.status_code}: {r.text[:200]}")
except Exception as e:
    print(f"  ❌ URL fetch failed: {e}")
    sys.exit(1)

# Get Facebook channel
channel = db.scalars(select(SocialAccount).where(SocialAccount.platform == 'facebook')).first()
if not channel:
    print("❌ No Facebook channel found")
    sys.exit(1)

print(f"\nChannel: {channel.platform_account_id}")

# Decrypt token
try:
    token = decrypt_secret(channel.access_token_encrypted)
    print(f"  Token: {token[:20]}...")
except Exception as e:
    print(f"  ❌ Token decrypt failed: {e}")
    sys.exit(1)

# Compose text
text = compose_text(post)
print(f"\nText (first 100 chars): {text[:100]}")

# Try publishing to Facebook
print(f"\n📤 Publishing to Facebook Page {channel.platform_account_id}...")
graph_url = f"https://graph.facebook.com/v19.0/{channel.platform_account_id}/photos"
payload = {
    "caption": text,
    "url": signed_url,
    "access_token": token,
}

try:
    r = httpx.post(graph_url, data=payload, timeout=60)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")

    if r.status_code in (200, 201):
        result = r.json()
        print(f"✅ SUCCESS: Posted with ID {result.get('id')}")
    else:
        print(f"❌ FAILED: {r.status_code}")

except Exception as e:
    print(f"❌ Request failed: {e}")
    sys.exit(1)
