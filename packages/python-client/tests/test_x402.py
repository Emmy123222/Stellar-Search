"""
Unit tests for x402 parsing, serialization, and secret redaction.
"""

import base64
import json
import os
import sys
import unittest

_PACKAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PACKAGE_DIR not in sys.path:
    sys.path.insert(0, _PACKAGE_DIR)

from stellar_search.x402 import (
    encode_payment_headers,
    extract_settlement_response,
    get_header_case_insensitive,
    parse_payment_challenge,
    redact_secret,
)
from tests.fixtures import MOCK_CHALLENGE_DICT


class TestX402(unittest.TestCase):
    def test_redact_secret(self) -> None:
        self.assertEqual(redact_secret(""), "<empty>")
        self.assertEqual(redact_secret(None), "<empty>")
        self.assertEqual(redact_secret("1234"), "****")
        self.assertEqual(redact_secret("ab"), "**")

        secret = "SCZANGBA5YHTNYVVV4C3U252E2B6P6IRKDMPWAIBD4NTG44RGBOEVKFX"
        redacted = redact_secret(secret)
        self.assertTrue(redacted.startswith("SC"))
        self.assertTrue(redacted.endswith("FX"))
        self.assertNotIn("ZANGBA", redacted)
        self.assertIn("****", redacted)

    def test_get_header_case_insensitive(self) -> None:
        headers = {
            "Content-Type": "application/json",
            "X-Payment": "sig-123",
            "Payment-Required": "chal-456",
        }
        self.assertEqual(get_header_case_insensitive(headers, "content-type"), "application/json")
        self.assertEqual(get_header_case_insensitive(headers, "x-payment"), "sig-123")
        self.assertEqual(get_header_case_insensitive(headers, "PAYMENT-REQUIRED"), "chal-456")
        self.assertIsNone(get_header_case_insensitive(headers, "authorization"))
        self.assertIsNone(get_header_case_insensitive(None, "content-type"))

    def test_parse_payment_challenge_from_base64_header(self) -> None:
        b64 = base64.b64encode(json.dumps(MOCK_CHALLENGE_DICT).encode("utf-8")).decode("ascii")
        headers = {"PAYMENT-REQUIRED": b64}

        challenge = parse_payment_challenge(headers=headers)
        self.assertIsNotNone(challenge)
        assert challenge is not None
        self.assertEqual(challenge.x402_version, 2)
        self.assertEqual(challenge.error, "Payment required")
        self.assertEqual(len(challenge.accepts), 1)
        self.assertEqual(challenge.accepts[0].scheme, "exact")
        self.assertEqual(challenge.accepts[0].amount, "10000")
        self.assertEqual(
            challenge.accepts[0].asset,
            "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
        )
        self.assertEqual(
            challenge.accepts[0].pay_to,
            "GBBD47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA",
        )

    def test_parse_payment_challenge_from_plain_json_header(self) -> None:
        json_str = json.dumps(MOCK_CHALLENGE_DICT)
        headers = {"payment-required": json_str}

        challenge = parse_payment_challenge(headers=headers)
        self.assertIsNotNone(challenge)
        assert challenge is not None
        self.assertEqual(len(challenge.accepts), 1)
        self.assertEqual(challenge.accepts[0].amount, "10000")

    def test_parse_payment_challenge_from_body_dict(self) -> None:
        challenge = parse_payment_challenge(headers={}, body=MOCK_CHALLENGE_DICT)
        self.assertIsNotNone(challenge)
        assert challenge is not None
        self.assertEqual(len(challenge.accepts), 1)
        self.assertEqual(challenge.accepts[0].network, "stellar:testnet")

    def test_parse_payment_challenge_empty_or_invalid(self) -> None:
        self.assertIsNone(parse_payment_challenge(headers={}, body=None))
        self.assertIsNone(parse_payment_challenge(headers={"other": "123"}, body="invalid json"))

    def test_encode_payment_headers_string(self) -> None:
        headers = encode_payment_headers("raw-signature-token")
        self.assertEqual(headers["PAYMENT-SIGNATURE"], "raw-signature-token")
        self.assertEqual(headers["x-payment"], "raw-signature-token")

    def test_encode_payment_headers_dict(self) -> None:
        payload = {"scheme": "exact", "amount": "10000"}
        headers = encode_payment_headers(payload)
        self.assertIn("PAYMENT-SIGNATURE", headers)
        self.assertEqual(headers["PAYMENT-SIGNATURE"], headers["x-payment"])

        decoded = json.loads(base64.b64decode(headers["PAYMENT-SIGNATURE"]).decode("utf-8"))
        self.assertEqual(decoded["scheme"], "exact")
        self.assertEqual(decoded["amount"], "10000")

    def test_extract_settlement_response_hex64(self) -> None:
        hex_hash = "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef"
        res = extract_settlement_response({"X-PAYMENT-RESPONSE": hex_hash})
        self.assertEqual(res["tx_hash"], hex_hash)

    def test_extract_settlement_response_base64_json(self) -> None:
        payload = {"transactionHash": "hash999888777"}
        b64 = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
        res = extract_settlement_response({"x-payment-response": b64})
        self.assertEqual(res["tx_hash"], "hash999888777")

    def test_extract_settlement_response_missing(self) -> None:
        res = extract_settlement_response({})
        self.assertIsNone(res["tx_hash"])
        self.assertIsNone(res["raw"])


if __name__ == "__main__":
    unittest.main()
