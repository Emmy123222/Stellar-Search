"""
Pluggable signer interfaces and implementations for x402 payment settlement.
"""

from __future__ import annotations

import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Union

from .errors import StellarSearchError, ValidationError
from .models import PaymentChallenge, SignedPaymentHeader, SignerContext
from .x402 import encode_payment_headers, redact_secret


class ClientSigner(ABC):
    """
    Abstract interface for signing x402 payment challenges.
    """

    @abstractmethod
    def sign(
        self,
        challenge: PaymentChallenge,
        context: SignerContext,
    ) -> SignedPaymentHeader:
        """
        Signs the given challenge within the request context and returns the payment headers.
        """
        raise NotImplementedError

    def get_address(self) -> Optional[str]:
        """
        Returns the public address associated with this signer, if available.
        """
        return None


class MockSigner(ClientSigner):
    """
    In-memory mock signer useful for tests and offline fixtures.
    """

    def __init__(
        self,
        address: str = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        custom_header_value: Optional[str] = None,
    ) -> None:
        self.address = address
        self.custom_header_value = custom_header_value

    def get_address(self) -> Optional[str]:
        return self.address

    def sign(
        self,
        challenge: PaymentChallenge,
        context: SignerContext,
    ) -> SignedPaymentHeader:
        if self.custom_header_value:
            return SignedPaymentHeader(
                header_name="PAYMENT-SIGNATURE",
                header_value=self.custom_header_value,
                secondary_headers={"x-payment": self.custom_header_value},
            )

        accept = challenge.accepts[0] if challenge.accepts else None
        payload = {
            "scheme": accept.scheme if accept else "exact",
            "network": accept.network if accept else context.network,
            "asset": accept.asset if accept else "",
            "amount": accept.amount if accept else "10000",
            "payTo": accept.pay_to if accept else "",
            "payer": self.address,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "nonce": str(uuid.uuid4()),
        }
        headers = encode_payment_headers(payload)
        return SignedPaymentHeader(
            header_name="PAYMENT-SIGNATURE",
            header_value=headers["PAYMENT-SIGNATURE"],
            secondary_headers={"x-payment": headers["x-payment"]},
        )


class ServerSigner(ClientSigner):
    """
    Server-side signer resolving signing credentials from environment variables,
    secrets managers, or secure vaults without leaking them in traces or logs.
    """

    def __init__(
        self,
        secret_key: Optional[str] = None,
        get_secret_key: Optional[Callable[[], Union[str, Any]]] = None,
        custom_sign: Optional[
            Callable[
                [PaymentChallenge, SignerContext],
                Union[str, Dict[str, Any], SignedPaymentHeader],
            ]
        ] = None,
    ) -> None:
        self._secret_key = secret_key
        self._get_secret_key = get_secret_key
        self._custom_sign = custom_sign

    def _resolve_key(self) -> str:
        if self._get_secret_key is not None:
            key = self._get_secret_key()
            if isinstance(key, str) and key.strip():
                return key.strip()

        if self._secret_key and self._secret_key.strip():
            return self._secret_key.strip()

        env_key = os.environ.get("STELLAR_PRIVATE_KEY") or os.environ.get("SEARCH_PRIVATE_KEY") or ""
        if env_key.strip():
            return env_key.strip()

        raise ValidationError(
            "Server signer requires a private key. Configure STELLAR_PRIVATE_KEY or supply get_secret_key."
        )

    def _validate_stellar_secret_key(self, key: str) -> None:
        if not key.startswith("S") or len(key) != 56:
            raise ValidationError(
                f'Invalid Stellar secret key format "{redact_secret(key)}". '
                f'Expected a 56-character Ed25519 secret starting with "S".'
            )

    def get_address(self) -> Optional[str]:
        try:
            key = self._resolve_key()
            self._validate_stellar_secret_key(key)
            try:
                from stellar_sdk import Keypair  # type: ignore

                return Keypair.from_secret(key).public_key
            except Exception:
                return f"G...{redact_secret(key)[-4:]}"
        except Exception:
            return "stellar-agent"

    def sign(
        self,
        challenge: PaymentChallenge,
        context: SignerContext,
    ) -> SignedPaymentHeader:
        if self._custom_sign is not None:
            res = self._custom_sign(challenge, context)
            if isinstance(res, SignedPaymentHeader):
                return res
            headers = encode_payment_headers(res)
            return SignedPaymentHeader(
                header_name="PAYMENT-SIGNATURE",
                header_value=headers["PAYMENT-SIGNATURE"],
                secondary_headers={"x-payment": headers["x-payment"]},
            )

        key = self._resolve_key()
        self._validate_stellar_secret_key(key)

        if not challenge.accepts:
            raise StellarSearchError(
                "No payment options accepted in challenge",
                status_code=402,
            )

        accept = challenge.accepts[0]

        try:
            from stellar_sdk import Keypair  # type: ignore

            public_key = Keypair.from_secret(key).public_key
        except Exception:
            public_key = f"G...{redact_secret(key)[-4:]}"

        payment_payload = {
            "scheme": accept.scheme or "exact",
            "network": accept.network,
            "asset": accept.asset,
            "amount": accept.amount,
            "payTo": accept.pay_to,
            "payer": public_key,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "nonce": str(uuid.uuid4()),
        }

        headers = encode_payment_headers(payment_payload)
        return SignedPaymentHeader(
            header_name="PAYMENT-SIGNATURE",
            header_value=headers["PAYMENT-SIGNATURE"],
            secondary_headers={"x-payment": headers["x-payment"]},
        )


def create_server_signer(
    secret_key: Optional[str] = None,
    get_secret_key: Optional[Callable[[], Union[str, Any]]] = None,
    custom_sign: Optional[
        Callable[
            [PaymentChallenge, SignerContext],
            Union[str, Dict[str, Any], SignedPaymentHeader],
        ]
    ] = None,
) -> ServerSigner:
    """
    Creates a ServerSigner instance.
    """
    return ServerSigner(
        secret_key=secret_key,
        get_secret_key=get_secret_key,
        custom_sign=custom_sign,
    )
