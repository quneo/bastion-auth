import base64
import hashlib
import hmac
import os
import secrets
from functools import lru_cache
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import get_settings

MIN_PASSWORD_LENGTH = 10

_hasher = PasswordHasher()
# Verified against when the user does not exist, so timing does not reveal valid usernames.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def constant_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def _keys_dir() -> Path:
    path = get_settings().data_dir / "keys"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)


@lru_cache
def _fernet() -> Fernet:
    path = _keys_dir() / "secrets.key"
    if not path.exists():
        _write_private(path, Fernet.generate_key())
    return Fernet(path.read_bytes().strip())


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:  # key changed or data corrupted
        raise ValueError("cannot decrypt stored secret") from exc


@lru_cache
def signing_key() -> rsa.RSAPrivateKey:
    path = _keys_dir() / "oidc-signing.pem"
    if not path.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
        _write_private(path, pem)
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    assert isinstance(key, rsa.RSAPrivateKey)
    return key


def _b64(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@lru_cache
def public_jwk() -> dict:
    numbers = signing_key().public_key().public_numbers()
    jwk = {"kty": "RSA", "e": _b64(numbers.e), "n": _b64(numbers.n)}
    # RFC 7638 thumbprint as key id
    canonical = '{"e":"%s","kty":"RSA","n":"%s"}' % (jwk["e"], jwk["n"])
    kid = base64.urlsafe_b64encode(hashlib.sha256(canonical.encode()).digest()).rstrip(b"=").decode()
    return {**jwk, "kid": kid, "use": "sig", "alg": "RS256"}


def reset_key_caches() -> None:
    _fernet.cache_clear()
    signing_key.cache_clear()
    public_jwk.cache_clear()
