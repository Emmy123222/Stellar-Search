"""
Comprehensive unit tests for StellarSearchClient and AsyncStellarSearchClient.
"""

import asyncio
import base64
import json
import os
import sys
import unittest
from typing import Dict, List, Optional

_PACKAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PACKAGE_DIR not in sys.path:
    sys.path.insert(0, _PACKAGE_DIR)

from stellar_search.client import AsyncStellarSearchClient, StellarSearchClient
from stellar_search.errors import (
    PaymentApprovalRejectedError,
    PaymentFailedError,
    PaymentRequiredError,
    StellarSearchError,
    ValidationError,
)
from stellar_search.models import PaymentChallenge
from stellar_search.signers import MockSigner
from tests.fixtures import (
    MOCK_CHALLENGE_DICT,
    SAMPLE_DISCOVERY_METADATA_DICT,
    SAMPLE_HEALTH_RESPONSE_DICT,
    SAMPLE_IMAGE_RESPONSE_DICT,
    SAMPLE_NEWS_RESPONSE_DICT,
    SAMPLE_SEARCH_RESPONSE_DICT,
)


class TestClient(unittest.TestCase):
    def setUp(self) -> None:
        self.b64_challenge = base64.b64encode(
            json.dumps(MOCK_CHALLENGE_DICT).encode("utf-8")
        ).decode("ascii")

    def test_query_validation(self) -> None:
        client = StellarSearchClient()
        with self.assertRaises(ValidationError):
            client.search("")
        with self.assertRaises(ValidationError):
            client.search("   ")
        with self.assertRaises(ValidationError):
            client.search_images("")
        with self.assertRaises(ValidationError):
            client.search_news("")
        with self.assertRaises(ValidationError):
            client.search("a" * 257)

    def test_search_200_ok(self) -> None:
        recorded_calls: List[Dict[str, any]] = []

        def mock_transport(url, method, headers, body, timeout):
            recorded_calls.append({"url": url, "method": method, "headers": headers})
            return 200, {}, json.dumps(SAMPLE_SEARCH_RESPONSE_DICT).encode("utf-8")

        client = StellarSearchClient(http_transport=mock_transport)
        resp = client.search("stellar blockchain", count=5)

        self.assertEqual(len(recorded_calls), 1)
        self.assertIn("q=stellar+blockchain", recorded_calls[0]["url"])
        self.assertIn("count=5", recorded_calls[0]["url"])
        self.assertEqual(resp.query, "stellar blockchain")
        self.assertEqual(len(resp.results), 1)
        self.assertEqual(resp.tx_hash, "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef")

    def test_search_forwards_optional_params(self) -> None:
        recorded_calls: List[Dict[str, any]] = []

        def mock_transport(url, method, headers, body, timeout):
            recorded_calls.append({"url": url})
            return 200, {}, json.dumps(SAMPLE_SEARCH_RESPONSE_DICT).encode("utf-8")

        client = StellarSearchClient(http_transport=mock_transport)
        client.search(
            "stellar",
            count=10,
            freshness="pw",
            include_domains=["stellar.org", "github.com"],
            exclude_domains=["spam.com"],
            suggestions=True,
        )

        called_url = recorded_calls[0]["url"]
        self.assertIn("count=10", called_url)
        self.assertIn("freshness=pw", called_url)
        self.assertIn("includeDomains=stellar.org%2Cgithub.com", called_url)
        self.assertIn("excludeDomains=spam.com", called_url)
        self.assertIn("suggestions=1", called_url)

    def test_search_402_without_signer_raises_payment_required_error(self) -> None:
        def mock_transport(url, method, headers, body, timeout):
            resp_headers = {"PAYMENT-REQUIRED": self.b64_challenge}
            return 402, resp_headers, b'{"error": "Payment required"}'

        client = StellarSearchClient(http_transport=mock_transport)
        with self.assertRaises(PaymentRequiredError) as ctx:
            client.search("stellar")

        self.assertIn("Payment required", str(ctx.exception))
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertEqual(len(ctx.exception.challenge.accepts), 1)

    def test_search_402_rejected_by_user_hook(self) -> None:
        def mock_transport(url, method, headers, body, timeout):
            resp_headers = {"PAYMENT-REQUIRED": self.b64_challenge}
            return 402, resp_headers, b'{"error": "Payment required"}'

        def reject_hook(challenge: PaymentChallenge) -> bool:
            return False

        client = StellarSearchClient(
            signer=MockSigner(),
            on_payment_required=reject_hook,
            http_transport=mock_transport,
        )

        with self.assertRaises(PaymentApprovalRejectedError):
            client.search("stellar")

    def test_search_402_approved_and_retried_with_payment_headers(self) -> None:
        calls = []

        def mock_transport(url, method, headers, body, timeout):
            calls.append({"url": url, "headers": headers})
            if len(calls) == 1:
                # 402 Challenge
                resp_headers = {"PAYMENT-REQUIRED": self.b64_challenge}
                return 402, resp_headers, b'{"error": "Payment required"}'
            else:
                # Retry with payment headers succeeds
                settlement_hash = "f" * 64
                resp_headers = {"x-payment-response": settlement_hash}
                return 200, resp_headers, json.dumps(SAMPLE_SEARCH_RESPONSE_DICT).encode("utf-8")

        signer = MockSigner()
        client = StellarSearchClient(
            signer=signer,
            on_payment_required=lambda chal: True,
            http_transport=mock_transport,
        )

        resp = client.search("stellar")
        self.assertEqual(len(calls), 2)
        retry_headers = calls[1]["headers"]
        self.assertIn("PAYMENT-SIGNATURE", retry_headers)
        self.assertIn("x-payment", retry_headers)
        self.assertEqual(resp.query, "stellar blockchain")

    def test_search_402_retry_failed_raises_payment_failed_error(self) -> None:
        calls = []

        def mock_transport(url, method, headers, body, timeout):
            calls.append(url)
            if len(calls) == 1:
                return 402, {"PAYMENT-REQUIRED": self.b64_challenge}, b'{"error": "Payment required"}'
            else:
                return 402, {}, b'{"error": "Insufficient balance on signer account"}'

        client = StellarSearchClient(
            signer=MockSigner(),
            http_transport=mock_transport,
        )

        with self.assertRaises(PaymentFailedError) as ctx:
            client.search("stellar")
        self.assertIn("Insufficient balance", str(ctx.exception))
        self.assertEqual(ctx.exception.status_code, 402)

    def test_search_images_and_news(self) -> None:
        def mock_transport(url, method, headers, body, timeout):
            if "/images" in url:
                return 200, {}, json.dumps(SAMPLE_IMAGE_RESPONSE_DICT).encode("utf-8")
            if "/news" in url:
                return 200, {}, json.dumps(SAMPLE_NEWS_RESPONSE_DICT).encode("utf-8")
            return 404, {}, b"{}"

        client = StellarSearchClient(http_transport=mock_transport)
        img_resp = client.search_images("stellar logo", count=5)
        self.assertEqual(img_resp.query, "stellar logo")
        self.assertEqual(len(img_resp.results), 1)

        news_resp = client.search_news("stellar updates", freshness="pw")
        self.assertEqual(news_resp.query, "stellar updates")
        self.assertEqual(len(news_resp.results), 1)

    def test_quote(self) -> None:
        def mock_transport(url, method, headers, body, timeout):
            return 402, {"PAYMENT-REQUIRED": self.b64_challenge}, b'{"error": "Payment required"}'

        client = StellarSearchClient(http_transport=mock_transport)
        challenge = client.quote("search", "stellar")
        self.assertEqual(len(challenge.accepts), 1)
        self.assertEqual(challenge.accepts[0].amount, "10000")

    def test_health_and_discovery(self) -> None:
        def mock_transport(url, method, headers, body, timeout):
            if "/health" in url:
                return 200, {}, json.dumps(SAMPLE_HEALTH_RESPONSE_DICT).encode("utf-8")
            if "/.well-known/x402" in url:
                return 200, {}, json.dumps(SAMPLE_DISCOVERY_METADATA_DICT).encode("utf-8")
            return 404, {}, b"{}"

        client = StellarSearchClient(http_transport=mock_transport)
        health = client.get_health()
        self.assertEqual(health.status, "ok")
        self.assertEqual(health.price_per_query, "0.001 USDC")

        disc = client.get_x402_discovery()
        self.assertEqual(disc.protocol, "x402")
        self.assertEqual(len(disc.resource_templates), 1)

    def test_async_client_search_200(self) -> None:
        def mock_transport(url, method, headers, body, timeout):
            if "/health" in url:
                return 200, {}, json.dumps(SAMPLE_HEALTH_RESPONSE_DICT).encode("utf-8")
            if "/images" in url:
                return 200, {}, json.dumps(SAMPLE_IMAGE_RESPONSE_DICT).encode("utf-8")
            return 200, {}, json.dumps(SAMPLE_SEARCH_RESPONSE_DICT).encode("utf-8")

        async def run_test():
            async with AsyncStellarSearchClient(http_transport=mock_transport) as client:
                res = await client.search("stellar")
                self.assertEqual(res.query, "stellar blockchain")

                img = await client.search_images("stellar logo")
                self.assertEqual(img.query, "stellar logo")

                health = await client.get_health()
                self.assertEqual(health.status, "ok")

        asyncio.run(run_test())

    def test_async_client_on_payment_required_coroutine(self) -> None:
        calls = []

        def mock_transport(url, method, headers, body, timeout):
            calls.append(url)
            if "/search" in url:
                if len(calls) == 1:
                    return 402, {"PAYMENT-REQUIRED": self.b64_challenge}, b'{"error": "Payment required"}'
                return 200, {}, json.dumps(SAMPLE_SEARCH_RESPONSE_DICT).encode("utf-8")
            return 402, {"PAYMENT-REQUIRED": self.b64_challenge}, b'{"error": "Payment required"}'

        async def async_hook(challenge: PaymentChallenge) -> bool:
            await asyncio.sleep(0.01)
            return True

        async def run_test():
            client = AsyncStellarSearchClient(
                signer=MockSigner(),
                on_payment_required=async_hook,
                http_transport=mock_transport,
            )
            res = await client.search("stellar")
            self.assertEqual(res.query, "stellar blockchain")

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
