from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BASTION_", env_file=".env", extra="ignore")

    # Where the database and generated keys live.
    data_dir: Path = Path("/data")
    database_url: str | None = None

    # Public base URL of this service. Used as the OIDC issuer, so it must be
    # exactly what browsers and projects use to reach Bastion.
    public_url: str = "http://localhost:8800"

    # Set to true once Bastion is served over HTTPS.
    cookie_secure: bool = False
    # Read client IP from X-Forwarded-For (only behind a trusted reverse proxy).
    trust_forwarded: bool = False

    session_ttl_hours: int = 24 * 14
    challenge_ttl_minutes: int = 10
    totp_issuer: str = "Bastion"

    auth_code_ttl_seconds: int = 60
    access_token_ttl_seconds: int = 3600
    id_token_ttl_seconds: int = 3600

    # Built frontend (index.html + assets). Optional in development.
    static_dir: Path | None = None

    @property
    def db_url(self) -> str:
        return self.database_url or f"sqlite:///{self.data_dir / 'bastion.db'}"

    @property
    def issuer(self) -> str:
        return self.public_url.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
