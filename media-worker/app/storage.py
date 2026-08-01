import boto3
from botocore.client import Config
from .models import ConnectionTest


def b2_client(connection: ConnectionTest):
    return boto3.client(
        "s3",
        endpoint_url=connection.b2_endpoint,
        aws_access_key_id=connection.b2_key_id.get_secret_value(),
        aws_secret_access_key=connection.b2_app_key.get_secret_value(),
        config=Config(signature_version="s3v4", retries={"max_attempts": 4, "mode": "adaptive"}),
    )


def test_b2(connection: ConnectionTest) -> None:
    b2_client(connection).head_bucket(Bucket=connection.b2_bucket)
