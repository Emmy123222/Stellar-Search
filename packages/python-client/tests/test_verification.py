"""
Unit tests for on-chain receipt verification against Horizon.
"""

import os
import sys
import unittest
from typing import Any, Dict

_PACKAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PACKAGE_DIR not in sys.path:
    sys.path.insert(0, _PACKAGE_DIR)

from stellar_search.models import SearchReceipt
from stellar_search.verification import (
    HORIZON_MAINNET,
    HORIZON_TESTNET,
    get_horizon_url_for_network,
    verify_receipt_against_horizon,
    verify_receipts_against_horizon,
)

DESTINATION = "GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3"
VALID_RECEIPT = SearchReceipt(
    tx_hash="a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
    query="stellar smart contracts",
    amount="0.001",
    asset="USDC",
    destination=DESTINATION,
    network="stellar:testnet",
    timestamp="2026-09-01T12:00:00.000Z",
)


class TestVerification(unittest.TestCase):
    def test_get_horizon_url_for_network(self) -> None:
        self.assertEqual(get_horizon_url_for_network("stellar:testnet"), HORIZON_TESTNET)
        self.assertEqual(get_horizon_url_for_network("stellar:mainnet"), HORIZON_MAINNET)
        self.assertEqual(get_horizon_url_for_network("unknown"), HORIZON_TESTNET)

    def test_verify_receipt_missing_tx_hash(self) -> None:
        receipt = SearchReceipt(
            tx_hash="",
            query="test",
            amount="0.001",
            timestamp="2026-01-01",
            network="stellar:testnet",
        )
        res = verify_receipt_against_horizon(receipt)
        self.assertEqual(res.status, "mismatched")
        self.assertIn("Missing or empty transaction hash", res.mismatches)

    def test_verify_receipt_invalid_network(self) -> None:
        receipt = SearchReceipt(
            tx_hash="hash123",
            query="test",
            amount="0.001",
            timestamp="2026-01-01",
            network="eth:mainnet",
        )
        res = verify_receipt_against_horizon(receipt)
        self.assertEqual(res.status, "mismatched")
        self.assertIn('Invalid network identifier: "eth:mainnet"', res.mismatches)

    def test_verify_receipt_network_mismatch(self) -> None:
        res = verify_receipt_against_horizon(VALID_RECEIPT, expected_network="stellar:mainnet")
        self.assertEqual(res.status, "mismatched")
        self.assertTrue(any("Network mismatch" in m for m in res.mismatches))

    def test_verify_receipt_horizon_404(self) -> None:
        def mock_http(url: str) -> tuple[int, Dict[str, Any]]:
            return 404, {}

        res = verify_receipt_against_horizon(VALID_RECEIPT, http_get_fn=mock_http)
        self.assertEqual(res.status, "mismatched")
        self.assertIn("Transaction not found on Stellar Horizon ledger", res.mismatches)

    def test_verify_receipt_horizon_500(self) -> None:
        def mock_http(url: str) -> tuple[int, Dict[str, Any]]:
            return 500, {}

        res = verify_receipt_against_horizon(VALID_RECEIPT, http_get_fn=mock_http)
        self.assertEqual(res.status, "unverified")
        self.assertIn("Horizon API error (500)", str(res.error))

    def test_verify_receipt_ledger_failed_tx(self) -> None:
        def mock_http(url: str) -> tuple[int, Dict[str, Any]]:
            return 200, {"successful": False, "ledger": 12345}

        res = verify_receipt_against_horizon(VALID_RECEIPT, http_get_fn=mock_http)
        self.assertEqual(res.status, "mismatched")
        self.assertIn("Transaction failed on ledger (successful: false)", res.mismatches)
        self.assertEqual(res.ledger_sequence, 12345)

    def test_verify_receipt_confirmed_payment_op(self) -> None:
        def mock_http(url: str) -> tuple[int, Dict[str, Any]]:
            if "/operations" in url:
                return 200, {
                    "_embedded": {
                        "records": [
                            {
                                "type": "payment",
                                "to": DESTINATION,
                                "amount": "0.0010000",
                                "asset_code": "USDC",
                            }
                        ]
                    }
                }
            return 200, {"successful": True, "ledger": 98765}

        res = verify_receipt_against_horizon(VALID_RECEIPT, http_get_fn=mock_http)
        self.assertEqual(res.status, "confirmed")
        self.assertEqual(res.ledger_sequence, 98765)
        self.assertEqual(res.destination, DESTINATION)
        self.assertEqual(res.asset, "USDC")

    def test_verify_receipt_confirmed_soroban_op(self) -> None:
        def mock_http(url: str) -> tuple[int, Dict[str, Any]]:
            if "/operations" in url:
                return 200, {
                    "records": [
                        {
                            "type": "invoke_host_function",
                        }
                    ]
                }
            return 200, {"successful": True, "ledger": 55555}

        res = verify_receipt_against_horizon(
            VALID_RECEIPT,
            expected_destination=DESTINATION,
            http_get_fn=mock_http,
        )
        self.assertEqual(res.status, "confirmed")
        self.assertEqual(res.ledger_sequence, 55555)
        self.assertEqual(res.destination, DESTINATION)

    def test_verify_receipts_batch(self) -> None:
        def mock_http(url: str) -> tuple[int, Dict[str, Any]]:
            if "/operations" in url:
                return 200, {
                    "records": [
                        {
                            "type": "payment",
                            "to": DESTINATION,
                            "amount": "0.001",
                            "asset_code": "USDC",
                        }
                    ]
                }
            return 200, {"successful": True, "ledger": 11111}

        batch = [VALID_RECEIPT]
        results = verify_receipts_against_horizon(batch, http_get_fn=mock_http)
        self.assertIn(VALID_RECEIPT.tx_hash, results)
        self.assertEqual(results[VALID_RECEIPT.tx_hash].status, "confirmed")


if __name__ == "__main__":
    unittest.main()
