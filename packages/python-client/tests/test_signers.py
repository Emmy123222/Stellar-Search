"""
Unit tests for pluggable signers (MockSigner, ServerSigner).
"""

import base64
import json
import os
import sys
import unittest

_PACKAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PACKAGE_DIR not in sys.path:
    sys.path.insert(0, _PACKAGE_DIR)

from stellar_search.errors import ValidationError
from stellar_search.models import PaymentChallenge, SignerContext
from stellar_search.signers import MockSigner, ServerSigner, create_server_signer
from tests.fixtures import MOCK_CHALLENGE_DICT


class TestSigners(unittest.TestCase):
    def setUp(self) -> None:
        self.challenge = PaymentChallenge.from_dict(MOCK_CHALLENGE_DICT)
        self.context = SignerContext(
            url="http://localhost:3001/search?q=stellar",
            method="GET",
            network="stellar:testnet",
            challenge=self.challenge,
        )

    def test_mock_signer(self) -> None:
        signer = MockSigner(address="GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37")
        self.assertEqual(
            signer.get_address(),
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        )

        signed = signer.sign(self.challenge, self.context)
        self.assertEqual(signed.header_name, "PAYMENT-SIGNATURE")
        self.assertIn("PAYMENT-SIGNATURE", signed.to_dict()["header_name"])
        self.assertIsNotNone(signed.secondary_headers)
        assert signed.secondary_headers is not None
        self.assertEqual(signed.secondary_headers["x-payment"], signed.header_value)

        decoded = json.loads(base64.b64decode(signed.header_value).decode("utf-8"))
        self.assertEqual(decoded["payer"], "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37")
        self.assertEqual(decoded["amount"], "10000")
        self.assertIn("nonce", decoded)
        self.assertIn("timestamp", decoded)

    def test_server_signer_missing_key_raises_validation_error(self) -> None:
        signer = ServerSigner()
        with self.assertRaises(ValidationError) as ctx:
            signer.sign(self.challenge, self.context)
        self.assertIn("Server signer requires a private key", str(ctx.exception))

    def test_server_signer_invalid_key_format(self) -> None:
        signer = create_server_signer(secret_key="invalid-key-short")
        with self.assertRaises(ValidationError) as ctx:
            signer.sign(self.challenge, self.context)
        self.assertIn("Invalid Stellar secret key format", str(ctx.exception))
        self.assertNotIn("invalid-key-short", str(ctx.exception))  # Ensured redacted

    def test_server_signer_valid_key(self) -> None:
        valid_seed = "SCZANGBA5YHTNYVVV4C3U252E2B6P6IRKDMPWAIBD4NTG44RGBOEVKFX"
        signer = create_server_signer(secret_key=valid_seed)
        signed = signer.sign(self.challenge, self.context)

        self.assertEqual(signed.header_name, "PAYMENT-SIGNATURE")
        decoded = json.loads(base64.b64decode(signed.header_value).decode("utf-8"))
        self.assertEqual(decoded["scheme"], "exact")
        self.assertEqual(decoded["network"], "stellar:testnet")
        self.assertEqual(decoded["amount"], "10000")
        self.assertIn("nonce", decoded)

    def test_server_signer_custom_sign(self) -> None:
        def custom_sign_fn(challenge, context):
            return {"custom": "payload", "amount": challenge.accepts[0].amount}

        signer = create_server_signer(custom_sign=custom_sign_fn)
        signed = signer.sign(self.challenge, self.context)
        decoded = json.loads(base64.b64decode(signed.header_value).decode("utf-8"))
        self.assertEqual(decoded["custom"], "payload")
        self.assertEqual(decoded["amount"], "10000")


if __name__ == "__main__":
    unittest.main()
