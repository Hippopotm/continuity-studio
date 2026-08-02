import boto3
from botocore.client import Config
from urllib.parse import unquote, urlparse
from .models import ConnectionTest


def b2_client(connection: ConnectionTest):
    return boto3.client(
        "s3",
        endpoint_url=connection.b2_endpoint,
        aws_access_key_id=connection.b2_key_id.get_secret_value(),
        aws_secret_access_key=connection.b2_app_key.get_secret_value(),
        config=Config(signature_version="s3v4", connect_timeout=8, read_timeout=12,
                      retries={"max_attempts": 2, "mode": "standard"}),
    )


def test_b2(connection: ConnectionTest) -> None:
    b2_client(connection).head_bucket(Bucket=connection.b2_bucket)


def put_asset(connection: ConnectionTest, key: str, body: bytes, content_type: str) -> str:
    """Upload bytes to B2 and return the S3-style URL that Genblaze also emits."""
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
