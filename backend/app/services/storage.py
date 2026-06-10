"""S3-compatible object storage (MinIO in dev) for logos and campaign assets."""
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings


def get_s3_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def ensure_bucket() -> None:
    settings = get_settings()
    s3 = get_s3_client()
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        s3.create_bucket(Bucket=settings.s3_bucket)


def upload_object(key: str, data: bytes, content_type: str) -> None:
    settings = get_settings()
    get_s3_client().put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)


def get_object(key: str) -> tuple[bytes, str]:
    settings = get_settings()
    obj = get_s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
    return obj["Body"].read(), obj.get("ContentType", "application/octet-stream")
