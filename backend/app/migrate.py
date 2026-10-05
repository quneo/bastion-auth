from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import get_settings

MIGRATIONS = Path(__file__).parent / "migrations"


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", get_settings().db_url.replace("%", "%%"))
    return cfg


def upgrade() -> None:
    command.upgrade(alembic_config(), "head")
