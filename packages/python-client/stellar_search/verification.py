"""
On-chain settlement receipt verification against the Stellar Horizon ledger.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Union

from .models import ReceiptVerificationDetail, SearchReceipt

HORIZON_TESTNET = "https://horizon-testnet.stellar.org"
HORIZON_MAINNET = "https://horizon.stellar.org"


def get_horizon_url_for_network(network: str) -> str:
    """
    Returns the appropriate Horizon endpoint URL for a given Stellar network identifier.
    """
    if network == "stellar:mainnet":
        return HORIZON_MAINNET
    return HORIZON_TESTNET


def _default_http_get(url: str, timeout: float = 15.0) -> tuple[int, Dict[str, Any]]:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "stellar-search-client-py"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = response.status
            body = response.read().decode("utf-8")
            return status, json.loads(body)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
            return exc.code, json.loads(body)
        except Exception:
            return exc.code, {}
    except Exception as exc:
        raise exc


def verify_receipt_against_horizon(
    receipt: Union[SearchReceipt, Dict[str, Any]],
    horizon_url: Optional[str] = None,
    expected_network: Optional[str] = None,
    expected_destination: Optional[str] = None,
    expected_asset: Optional[str] = None,
    expected_amount: Optional[Union[float, str]] = None,
    http_get_fn: Optional[Callable[[str], tuple[int, Dict[str, Any]]]] = None,
) -> ReceiptVerificationDetail:
    """
    Verifies a single SearchReceipt against the Stellar Horizon ledger.
    """
    if isinstance(receipt, dict):
        receipt = SearchReceipt.from_dict(receipt)

    fetch_fn = http_get_fn or _default_http_get

    # 1. Transaction Hash Presence Check
    if not receipt or not receipt.tx_hash or not receipt.tx_hash.strip():
        return ReceiptVerificationDetail(
            status="mismatched",
            mismatches=["Missing or empty transaction hash"],
            tx_hash=receipt.tx_hash if receipt else "",
            network=receipt.network if receipt else "",
        )

    tx_hash = receipt.tx_hash.strip()
    network = receipt.network or "stellar:testnet"

    # 2. Network Format & Expected Network Check
    if not network.startswith("stellar:"):
        return ReceiptVerificationDetail(
            status="mismatched",
            mismatches=[f'Invalid network identifier: "{network}"'],
            tx_hash=tx_hash,
            network=network,
        )

    if expected_network and network != expected_network:
        return ReceiptVerificationDetail(
            status="mismatched",
            mismatches=[f'Network mismatch: receipt specifies "{network}", expected "{expected_network}"'],
            tx_hash=tx_hash,
            network=network,
        )

    horizon_base = horizon_url or get_horizon_url_for_network(network)

    expected_amount_val: Optional[float] = None
    if receipt.amount:
        try:
            expected_amount_val = float(receipt.amount)
        except (ValueError, TypeError):
            pass
    elif expected_amount is not None:
        try:
            expected_amount_val = float(expected_amount)
        except (ValueError, TypeError):
            pass

    expected_asset_str = receipt.asset or expected_asset or "USDC"
    expected_dest_str = receipt.destination or expected_destination

    try:
        # 3. Query Horizon for Transaction Record
        status, tx_data = fetch_fn(f"{horizon_base}/transactions/{tx_hash}")

        if status == 404:
            return ReceiptVerificationDetail(
                status="mismatched",
                mismatches=["Transaction not found on Stellar Horizon ledger"],
                tx_hash=tx_hash,
                network=network,
            )

        if status != 200:
            return ReceiptVerificationDetail(
                status="unverified",
                error=f"Horizon API error ({status})",
                tx_hash=tx_hash,
                network=network,
            )

        if tx_data.get("successful") is False:
            return ReceiptVerificationDetail(
                status="mismatched",
                mismatches=["Transaction failed on ledger (successful: false)"],
                ledger_sequence=tx_data.get("ledger"),
                tx_hash=tx_hash,
                network=network,
                verified_at=datetime.now(timezone.utc).isoformat(),
            )

        ledger_sequence = tx_data.get("ledger")

        # 4. Query Horizon for Transaction Operations
        ops_status, ops_data = fetch_fn(f"{horizon_base}/transactions/{tx_hash}/operations")
        if ops_status != 200:
            return ReceiptVerificationDetail(
                status="unverified",
                error=f"Failed to fetch operations from Horizon ({ops_status})",
                ledger_sequence=ledger_sequence,
                tx_hash=tx_hash,
                network=network,
            )

        records: List[Dict[str, Any]] = []
        if isinstance(ops_data, dict):
            embedded = ops_data.get("_embedded")
            if isinstance(embedded, dict) and isinstance(embedded.get("records"), list):
                records = embedded["records"]
            elif isinstance(ops_data.get("records"), list):
                records = ops_data["records"]

        if not records:
            return ReceiptVerificationDetail(
                status="mismatched",
                mismatches=["Transaction contains no operations"],
                ledger_sequence=ledger_sequence,
                tx_hash=tx_hash,
                network=network,
                verified_at=datetime.now(timezone.utc).isoformat(),
            )

        # 5. Inspect operations for matching payment / invocation
        mismatches: List[str] = []
        has_matched_operation = False
        matched_dest: Optional[str] = None
        matched_amount: Optional[str] = None
        matched_asset: Optional[str] = None

        for op in records:
            op_type = op.get("type")
            # Payment or path payment
            if op_type in ("payment", "path_payment_strict_send", "path_payment_strict_receive"):
                dest = op.get("to") or op.get("into")
                amount = op.get("amount")
                asset_code = op.get("asset_code") or op.get("asset_type")

                # If destination check requested
                if expected_dest_str and dest != expected_dest_str:
                    continue

                # If asset check requested
                if expected_asset_str and asset_code and expected_asset_str not in (asset_code, "USDC"):
                    continue

                # If amount check requested
                if expected_amount_val is not None and amount is not None:
                    try:
                        amt_float = float(amount)
                        if abs(amt_float - expected_amount_val) > 0.00001:
                            continue
                    except (ValueError, TypeError):
                        continue

                has_matched_operation = True
                matched_dest = dest
                matched_amount = amount
                matched_asset = asset_code or expected_asset_str
                break

            # Soroban contract invocation (e.g. SAC transfer)
            elif op_type == "invoke_host_function":
                has_matched_operation = True
                matched_dest = expected_dest_str
                matched_amount = str(expected_amount_val) if expected_amount_val is not None else receipt.amount
                matched_asset = expected_asset_str
                break

        if not has_matched_operation:
            if expected_dest_str:
                mismatches.append(f'No operation paid expected destination "{expected_dest_str}"')
            else:
                mismatches.append("No compatible payment or contract operation found in transaction")

            return ReceiptVerificationDetail(
                status="mismatched",
                mismatches=mismatches,
                ledger_sequence=ledger_sequence,
                tx_hash=tx_hash,
                network=network,
                verified_at=datetime.now(timezone.utc).isoformat(),
            )

        return ReceiptVerificationDetail(
            status="confirmed",
            ledger_sequence=ledger_sequence,
            tx_hash=tx_hash,
            network=network,
            destination=matched_dest,
            amount=matched_amount,
            asset=matched_asset,
            verified_at=datetime.now(timezone.utc).isoformat(),
        )

    except Exception as exc:
        return ReceiptVerificationDetail(
            status="unverified",
            error=f"Verification request failed: {exc}",
            tx_hash=tx_hash,
            network=network,
        )


def verify_receipts_against_horizon(
    receipts: List[Union[SearchReceipt, Dict[str, Any]]],
    horizon_url: Optional[str] = None,
    expected_network: Optional[str] = None,
    expected_destination: Optional[str] = None,
    expected_asset: Optional[str] = None,
    http_get_fn: Optional[Callable[[str], tuple[int, Dict[str, Any]]]] = None,
) -> Dict[str, ReceiptVerificationDetail]:
    """
    Batch-verifies multiple on-chain search receipts against Stellar Horizon.
    """
    results: Dict[str, ReceiptVerificationDetail] = {}
    for r in receipts:
        detail = verify_receipt_against_horizon(
            r,
            horizon_url=horizon_url,
            expected_network=expected_network,
            expected_destination=expected_destination,
            expected_asset=expected_asset,
            http_get_fn=http_get_fn,
        )
        key = detail.tx_hash or (r.tx_hash if isinstance(r, SearchReceipt) else r.get("txHash") or r.get("tx_hash") or "")
        results[key] = detail
    return results
