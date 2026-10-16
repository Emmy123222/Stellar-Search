"""
x402 protocol helper utilities for header parsing, serialization, and secret redaction.
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, Mapping, Optional, Union

from .models import PaymentAcceptOption, PaymentChallenge


def redact_secret(value: Optional[str]) -> str:
    """
    Safely redacts private keys or secret material so secrets never appear
    in logs, error traces, or formatted strings.
    """
    raw = value.strip() if isinstance(value, str) else ""
    if not raw:
        return "<empty>"
    if len(raw) <= 4:
        return "*" * len(raw)
    head = raw[:2]
    tail = raw[-2:]
    mask_length = max(4, min(12, len(raw) - 4))
    return f"{head}{'*' * mask_length}{tail}"


def get_header_case_insensitive(
    headers: Optional[Mapping[str, Any]],
    name: str,
) -> Optional[str]:
    """
    Retrieves a header value case-insensitively from a dictionary or Headers object.
    """
    if not headers:
        return None

    # If headers has .get() and is case-insensitive (e.g. standard email.message or HTTPMessage)
    target = name.lower()
    for key, val in headers.items():
        if key.lower() == target:
            if isinstance(val, (list, tuple)):
                return str(val[0]) if val else None
            return str(val) if val is not None else None

    return None


def parse_payment_challenge(
    headers: Optional[Mapping[str, Any]] = None,
    body: Optional[Any] = None,
) -> Optional[PaymentChallenge]:
    """
    Parses an x402 payment challenge from response headers or response body.
    Supports both base64-encoded `PAYMENT-REQUIRED` headers and JSON payloads.
    """
    raw_header = get_header_case_insensitive(headers, "payment-required")
    parsed_json: Optional[Dict[str, Any]] = None

    if raw_header:
        # Attempt 1: Try base64 decoding
        try:
            decoded = base64.b64decode(raw_header).decode("utf-8")
            parsed_json = json.loads(decoded)
        except Exception:
            # Attempt 2: Try direct JSON parse in case it was sent as plain JSON string
            try:
                parsed_json = json.loads(raw_header)
            except Exception:
                parsed_json = None

    # Attempt 3: Fall back to body if header wasn't decodable
    if not parsed_json and body:
        if isinstance(body, dict):
            parsed_json = body
        elif isinstance(body, str):
            try:
                parsed_json = json.loads(body)
            except Exception:
                parsed_json = None
        elif isinstance(body, bytes):
            try:
                parsed_json = json.loads(body.decode("utf-8"))
            except Exception:
                parsed_json = None

    if not isinstance(parsed_json, dict):
        return None

    accepts: list[PaymentAcceptOption] = []
    accepts_raw = parsed_json.get("accepts")
    if isinstance(accepts_raw, list):
        for opt in accepts_raw:
            if isinstance(opt, dict):
                accepts.append(
                    PaymentAcceptOption(
                        scheme=str(opt.get("scheme", "exact")),
                        network=str(opt.get("network", "stellar:testnet")),
                        amount=str(opt.get("amount", "10000")),
                        asset=str(opt.get("asset", "")),
                        pay_to=str(opt.get("payTo") or opt.get("pay_to", "")),
                        max_timeout_seconds=opt.get("maxTimeoutSeconds") or opt.get("max_timeout_seconds"),
                        extra=opt.get("extra") if isinstance(opt.get("extra"), dict) else None,
                    )
                )

    return PaymentChallenge(
        x402_version=parsed_json.get("x402Version") or parsed_json.get("x402_version", 2),
        error=parsed_json.get("error", "Payment required"),
        resource=parsed_json.get("resource"),
        accepts=accepts,
        raw_header=raw_header or None,
    )


def encode_payment_headers(
    payload: Union[str, Dict[str, Any]],
) -> Dict[str, str]:
    """
    Encodes a signed payment signature or payload into standardized HTTP headers.
    """
    if isinstance(payload, str):
        header_value = payload.strip()
    elif isinstance(payload, dict):
        json_str = json.dumps(payload, separators=(",", ":"))
        header_value = base64.b64encode(json_str.encode("utf-8")).decode("ascii")
    else:
        json_str = json.dumps(payload)
        header_value = base64.b64encode(json_str.encode("utf-8")).decode("ascii")

    return {
        "PAYMENT-SIGNATURE": header_value,
        "x-payment": header_value,
    }


HEX_64_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


def extract_settlement_response(
    headers: Optional[Mapping[str, Any]],
) -> Dict[str, Optional[str]]:
    """
    Extracts the facilitator settlement receipt / transaction hash from response headers.
    Returns a dict with 'tx_hash' and 'raw'.
    """
    raw = get_header_case_insensitive(headers, "x-payment-response")
    if not raw:
        return {"tx_hash": None, "raw": None}

    raw_clean = raw.strip()
    if HEX_64_PATTERN.match(raw_clean):
        return {"tx_hash": raw_clean, "raw": raw}

    # Attempt to decode base64 or JSON envelope
    try:
        text = base64.b64decode(raw_clean).decode("utf-8")
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            tx_hash = parsed.get("transactionHash") or parsed.get("txHash")
            return {"tx_hash": tx_hash, "raw": raw}
    except Exception:
        pass

    try:
        parsed = json.loads(raw_clean)
        if isinstance(parsed, dict):
            tx_hash = parsed.get("transactionHash") or parsed.get("txHash")
            return {"tx_hash": tx_hash, "raw": raw}
    except Exception:
        pass

    return {"tx_hash": None, "raw": raw}
