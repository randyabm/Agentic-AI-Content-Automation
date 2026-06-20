-- Update instagram_oauth_scopes to the current Instagram Business API scopes
UPDATE settings
SET value = 'instagram_business_basic,instagram_business_content_publish',
    description = 'OAuth scopes to request for Instagram (comma-separated)'
WHERE key = 'instagram_oauth_scopes';

-- Add instagram_oauth_url if it does not exist yet
INSERT INTO settings (key, value, description)
VALUES (
    'instagram_oauth_url',
    'https://api.instagram.com/oauth/authorize',
    'Instagram OAuth authorization URL'
)
ON CONFLICT (key) DO NOTHING;
