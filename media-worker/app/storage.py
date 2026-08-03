import boto3
import os
from pydantic import SecretStr
from botocore.client import Config
from urllib.parse import unquote, urlparse
from .models import ConnectionTest


def resolve_b2_connection(connection: ConnectionTest) -> ConnectionTest:
    """Merge request-scoped provider data with server-owned B2 credentials."""
    key_id = connection.b2_key_id or SecretStr(os.getenv("B2_KEY_ID", ""))
    app_key = connection.b2_app_key or SecretStr(os.getenv("B2_APP_KEY", ""))
    bucket = connection.b2_bucket or os.getenv("B2_BUCKET", "ContinuityProject")
    endpoint = connection.b2_endpoint or os.getenv("B2_ENDPOINT", "https://s3.us-west-004.backblazeb2.com")
    if not key_id.get_secret_value() or not app_key.get_secret_value() or not bucket:
        raise ValueError("Backblaze B2 is not configured on the media worker")
    return connection.model_copy(update={
        "b2_key_id": key_id,
        "b2_app_key": app_key,
        "b2_bucket": bucket,
        "b2_endpoint": endpoint,
    })


def b2_client(connection: ConnectionTest):
    connection = resolve_b2_connection(connection)
    return boto3.client(
        "s3",
        endpoint_url=connection.b2_endpoint,
        aws_access_key_id=connection.b2_key_id.get_secret_value(),
        aws_secret_access_key=connection.b2_app_key.get_secret_value(),
        config=Config(signature_version="s3v4", connect_timeout=8, read_timeout=12,
                      retries={"max_attempts": 2, "mode": "standard"}),
    )


def test_b2(connection: ConnectionTest) -> None:
    connection = resolve_b2_connection(connection)
    b2_client(connection).head_bucket(Bucket=connection.b2_bucket)


def put_asset(connection: ConnectionTest, key: str, body: bytes, content_type: str) -> str:
    """Upload bytes to B2 and return the S3-style URL that Genblaze also emits."""
    connection = resolve_b2_connection(connection)
    b2_client(connection).put_object(
        Bucket=connection.b2_bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
    )
    endpoint = connection.b2_endpoint.rstrip("/")
    return f"{endpoint}/{connection.b2_bucket}/{key}"


def presign_asset(connection: ConnectionTest, url: str) -> str:
    """Return a short-lived browser URL for a Genblaze asset stored in B2."""
    connection = resolve_b2_connection(connection)
    parsed = urlparse(url)
    path = unquote(parsed.path).lstrip("/")
    bucket_prefix = f"{connection.b2_bucket}/"
    key = path[len(bucket_prefix):] if path.startswith(bucket_prefix) else path
    if not key:
        return url
    return b2_client(connection).generate_presigned_url(
        "get_object",
        Params={"Bucket": connection.b2_bucket, "Key": key},
        ExpiresIn=3600,
    )
