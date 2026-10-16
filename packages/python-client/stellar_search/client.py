"""
Synchronous and asynchronous client implementations for StellarSearch with x402 payment support.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Union

from .errors import (
    PaymentApprovalRejectedError,
    PaymentFailedError,
    PaymentRequiredError,
    StellarSearchError,
    ValidationError,
)
from .models import (
    ImageSearchResponse,
    NewsSearchResponse,
    PaymentChallenge,
    ReceiptVerificationDetail,
    SearchReceipt,
    SearchResponse,
    ServerHealthResponse,
    SignerContext,
    X402DiscoveryMetadata,
)
from .signers import ClientSigner
from .verification import (
    verify_receipt_against_horizon,
    verify_receipts_against_horizon,
)
from .x402 import extract_settlement_response, parse_payment_challenge

HttpTransportFn = Callable[
    [str, str, Optional[Dict[str, str]], Optional[bytes], float],
    tuple[int, Dict[str, str], bytes],
]


def _default_http_transport(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    body: Optional[bytes] = None,
    timeout: float = 30.0,
) -> tuple[int, Dict[str, str], bytes]:
    req = urllib.request.Request(
        url,
        data=body,
        headers=headers or {},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            resp_headers = {str(k): str(v) for k, v in resp.headers.items()}
            content = resp.read()
            return status, resp_headers, content
    except urllib.error.HTTPError as exc:
        resp_headers = {str(k): str(v) for k, v in exc.headers.items()} if exc.headers else {}
        content = exc.read() if exc.fp else b""
        return exc.code, resp_headers, content
    except urllib.error.URLError as exc:
        raise StellarSearchError(f"Network request failed: {exc.reason}", cause=exc) from exc
    except Exception as exc:
        raise StellarSearchError(f"Network request failed: {exc}", cause=exc) from exc


class StellarSearchClient:
    """
    Synchronous client for the StellarSearch API with automatic x402 micropayment handling.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3001",
        signer: Optional[ClientSigner] = None,
        network: str = "stellar:testnet",
        horizon_url: Optional[str] = None,
        on_payment_required: Optional[Callable[[PaymentChallenge], bool]] = None,
        timeout_seconds: float = 30.0,
        headers: Optional[Dict[str, str]] = None,
        http_transport: Optional[HttpTransportFn] = None,
    ) -> None:
        clean_base = base_url.rstrip("/") if base_url else "http://localhost:3001"
        self.base_url = clean_base
        self.network = network or "stellar:testnet"
        self.signer = signer
        self.horizon_url = horizon_url
        self.on_payment_required = on_payment_required
        self.timeout_seconds = timeout_seconds
        self.default_headers = dict(headers or {})
        self._transport = http_transport or _default_http_transport

    def _resolve_url(self, path: str) -> str:
        clean_path = path if path.startswith("/") else f"/{path}"
        if self.base_url.endswith("/api") and clean_path.startswith("/api/"):
            return f"{self.base_url}{clean_path[4:]}"
        return f"{self.base_url}{clean_path}"

    def _validate_search_query(self, query: str) -> str:
        if not isinstance(query, str) or not query.strip():
            raise ValidationError("Search query cannot be empty")
        clean = query.strip()
        if len(clean) > 256:
            raise ValidationError(
                f"Search query exceeds maximum length of 256 characters (got {len(clean)})"
            )
        return clean

    def _execute_request(
        self,
        endpoint_path: str,
        params: Dict[str, str],
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
        signer: Optional[ClientSigner] = None,
        payment_header: Optional[str] = None,
    ) -> Dict[str, Any]:
        query_string = urllib.parse.urlencode(params)
        full_url = f"{self._resolve_url(endpoint_path)}?{query_string}"
        timeout = timeout_seconds if timeout_seconds is not None else self.timeout_seconds

        req_headers: Dict[str, str] = {
            "Accept": "application/json",
            **self.default_headers,
            **(headers or {}),
        }

        if payment_header:
            req_headers["PAYMENT-SIGNATURE"] = payment_header
            req_headers["x-payment"] = payment_header

        # Step 1: Send initial request
        status, res_headers, res_body = self._transport(
            full_url,
            "GET",
            req_headers,
            None,
            timeout,
        )

        # Step 2: Handle non-402 responses
        if status == 200:
            try:
                data = json.loads(res_body.decode("utf-8")) if res_body else {}
            except Exception:
                data = {}
            settlement = extract_settlement_response(res_headers)
            if settlement.get("tx_hash") and not data.get("txHash") and not data.get("tx_hash"):
                data["txHash"] = settlement["tx_hash"]
                data["tx_hash"] = settlement["tx_hash"]
            return data

        if status != 402:
            try:
                error_body = json.loads(res_body.decode("utf-8")) if res_body else {}
            except Exception:
                error_body = {}
            msg = error_body.get("error") if isinstance(error_body, dict) else None
            msg = msg or f"Request failed with status {status}"
            if status == 400:
                raise ValidationError(msg)
            raise StellarSearchError(msg, status_code=status, details=error_body)

        # Step 3: Parse 402 Payment Challenge
        try:
            body_json = json.loads(res_body.decode("utf-8")) if res_body else None
        except Exception:
            body_json = None

        challenge = parse_payment_challenge(res_headers, body_json)
        if not challenge or not challenge.accepts:
            raise PaymentRequiredError(
                "Server returned 402 Payment Required but no valid x402 challenge was found",
                challenge or PaymentChallenge(accepts=[]),
            )

        # Step 4: Check explicit user approval hook if provided
        if self.on_payment_required is not None:
            approved = self.on_payment_required(challenge)
            if not approved:
                raise PaymentApprovalRejectedError(
                    "Payment approval rejected by on_payment_required hook",
                    challenge,
                )

        # Step 5: Check signer availability
        active_signer = signer or self.signer
        if not active_signer:
            accept_opt = challenge.accepts[0]
            raise PaymentRequiredError(
                f"Payment required ({accept_opt.amount} stroops / {accept_opt.asset or 'USDC'}). "
                f"Provide a signer to settle automatically.",
                challenge,
            )

        # Step 6: Generate signed payment credentials
        context = SignerContext(
            url=full_url,
            method="GET",
            network=challenge.accepts[0].network or self.network,
            challenge=challenge,
        )

        try:
            signed = active_signer.sign(challenge, context)
        except StellarSearchError:
            raise
        except Exception as exc:
            raise StellarSearchError(
                f"Signer failed to sign payment challenge: {exc}",
                status_code=402,
                cause=exc,
            ) from exc

        # Step 7: Retry request with payment headers
        retry_headers = {
            **req_headers,
            signed.header_name: signed.header_value,
            **(signed.secondary_headers or {}),
        }

        retry_status, retry_res_headers, retry_res_body = self._transport(
            full_url,
            "GET",
            retry_headers,
            None,
            timeout,
        )

        if retry_status != 200:
            try:
                retry_body = json.loads(retry_res_body.decode("utf-8")) if retry_res_body else {}
            except Exception:
                retry_body = {}
            server_err = retry_body.get("error") if isinstance(retry_body, dict) else None
            err_msg = server_err or f"Payment retry rejected ({retry_status})"
            raise PaymentFailedError(
                err_msg,
                status_code=retry_status,
                server_error=server_err,
                details=retry_body,
            )

        try:
            result_data = json.loads(retry_res_body.decode("utf-8")) if retry_res_body else {}
        except Exception:
            result_data = {}

        retry_settlement = extract_settlement_response(retry_res_headers)
        if retry_settlement.get("tx_hash") and not result_data.get("txHash") and not result_data.get("tx_hash"):
            result_data["txHash"] = retry_settlement["tx_hash"]
            result_data["tx_hash"] = retry_settlement["tx_hash"]

        return result_data

    def search(
        self,
        query: str,
        count: int = 5,
        freshness: Optional[str] = None,
        include_domains: Optional[List[str]] = None,
        exclude_domains: Optional[List[str]] = None,
        suggestions: bool = False,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
        signer: Optional[ClientSigner] = None,
        payment_header: Optional[str] = None,
    ) -> SearchResponse:
        """
        Performs a paid web search query with Serper.dev and x402 settlement.
        """
        clean_q = self._validate_search_query(query)
        clamped_count = min(max(count, 1), 20)

        params: Dict[str, str] = {
            "q": clean_q,
            "count": str(clamped_count),
        }
        if freshness in ("pd", "pw", "pm"):
            params["freshness"] = freshness
        if include_domains:
            params["includeDomains"] = ",".join(include_domains)
        if exclude_domains:
            params["excludeDomains"] = ",".join(exclude_domains)
        if suggestions:
            params["suggestions"] = "1"

        data = self._execute_request(
            "/search",
            params=params,
            timeout_seconds=timeout_seconds,
            headers=headers,
            signer=signer,
            payment_header=payment_header,
        )
        return SearchResponse.from_dict(data)

    def search_images(
        self,
        query: str,
        count: int = 10,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
        signer: Optional[ClientSigner] = None,
        payment_header: Optional[str] = None,
    ) -> ImageSearchResponse:
        """
        Performs a paid image search query with Serper.dev and x402 settlement.
        """
        clean_q = self._validate_search_query(query)
        clamped_count = min(max(count, 1), 10)

        params: Dict[str, str] = {
            "q": clean_q,
            "count": str(clamped_count),
        }
        data = self._execute_request(
            "/images",
            params=params,
            timeout_seconds=timeout_seconds,
            headers=headers,
            signer=signer,
            payment_header=payment_header,
        )
        return ImageSearchResponse.from_dict(data)

    def search_news(
        self,
        query: str,
        count: int = 10,
        freshness: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
        signer: Optional[ClientSigner] = None,
        payment_header: Optional[str] = None,
    ) -> NewsSearchResponse:
        """
        Performs a paid news search query with Serper.dev and x402 settlement.
        """
        clean_q = self._validate_search_query(query)
        clamped_count = min(max(count, 1), 20)

        params: Dict[str, str] = {
            "q": clean_q,
            "count": str(clamped_count),
        }
        if freshness in ("pd", "pw", "pm"):
            params["freshness"] = freshness

        data = self._execute_request(
            "/news",
            params=params,
            timeout_seconds=timeout_seconds,
            headers=headers,
            signer=signer,
            payment_header=payment_header,
        )
        return NewsSearchResponse.from_dict(data)

    def quote(
        self,
        endpoint: str,
        query: str,
        count: int = 5,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> PaymentChallenge:
        """
        Requests an x402 payment challenge / quote without settling payment.
        """
        clean_q = self._validate_search_query(query)
        clean_endpoint = endpoint.strip().lstrip("/")
        params = {"q": clean_q, "count": str(count)}
        query_string = urllib.parse.urlencode(params)
        full_url = f"{self._resolve_url(f'/{clean_endpoint}')}?{query_string}"
        timeout = timeout_seconds if timeout_seconds is not None else self.timeout_seconds

        req_headers = {
            "Accept": "application/json",
            **self.default_headers,
            **(headers or {}),
        }

        status, res_headers, res_body = self._transport(
            full_url,
            "GET",
            req_headers,
            None,
            timeout,
        )

        try:
            body = json.loads(res_body.decode("utf-8")) if res_body else None
        except Exception:
            body = None

        if status == 402:
            challenge = parse_payment_challenge(res_headers, body)
            if challenge:
                return challenge
            return PaymentChallenge(x402_version=2, error="Payment required", accepts=[])

        if status == 200:
            return PaymentChallenge(x402_version=2, error="No payment required", accepts=[])

        msg = body.get("error") if isinstance(body, dict) else f"Quote request failed with status {status}"
        raise StellarSearchError(msg, status_code=status, details=body)

    def health(self, timeout_seconds: Optional[float] = None) -> ServerHealthResponse:
        """
        Checks health and readiness of the StellarSearch server.
        """
        full_url = self._resolve_url("/health")
        timeout = timeout_seconds if timeout_seconds is not None else self.timeout_seconds
        req_headers = {"Accept": "application/json", **self.default_headers}

        status, _, res_body = self._transport(full_url, "GET", req_headers, None, timeout)
        try:
            body = json.loads(res_body.decode("utf-8")) if res_body else {}
        except Exception:
            body = {}

        if status != 200:
            msg = body.get("error") if isinstance(body, dict) else f"Health check failed ({status})"
            raise StellarSearchError(msg, status_code=status, details=body)

        return ServerHealthResponse.from_dict(body)

    def get_health(self, timeout_seconds: Optional[float] = None) -> ServerHealthResponse:
        """Alias for health()."""
        return self.health(timeout_seconds=timeout_seconds)

    def discovery(self, timeout_seconds: Optional[float] = None) -> X402DiscoveryMetadata:
        """
        Fetches x402 resource and price discovery metadata from /.well-known/x402.
        """
        full_url = self._resolve_url("/.well-known/x402")
        timeout = timeout_seconds if timeout_seconds is not None else self.timeout_seconds
        req_headers = {"Accept": "application/json", **self.default_headers}

        status, _, res_body = self._transport(full_url, "GET", req_headers, None, timeout)
        try:
            body = json.loads(res_body.decode("utf-8")) if res_body else {}
        except Exception:
            body = {}

        if status != 200:
            msg = body.get("error") if isinstance(body, dict) else f"Discovery failed ({status})"
            raise StellarSearchError(msg, status_code=status, details=body)

        return X402DiscoveryMetadata.from_dict(body)

    def get_x402_discovery(self, timeout_seconds: Optional[float] = None) -> X402DiscoveryMetadata:
        """Alias for discovery()."""
        return self.discovery(timeout_seconds=timeout_seconds)

    def verify_receipt(
        self,
        receipt: Union[SearchReceipt, Dict[str, Any]],
        horizon_url: Optional[str] = None,
        expected_network: Optional[str] = None,
        expected_destination: Optional[str] = None,
        expected_asset: Optional[str] = None,
        expected_amount: Optional[Union[float, str]] = None,
    ) -> ReceiptVerificationDetail:
        """
        Verifies an on-chain search receipt against the Stellar Horizon ledger.
        """
        return verify_receipt_against_horizon(
            receipt,
            horizon_url=horizon_url or self.horizon_url,
            expected_network=expected_network or self.network,
            expected_destination=expected_destination,
            expected_asset=expected_asset,
            expected_amount=expected_amount,
        )

    def verify_receipts(
        self,
        receipts: List[Union[SearchReceipt, Dict[str, Any]]],
        horizon_url: Optional[str] = None,
        expected_network: Optional[str] = None,
        expected_destination: Optional[str] = None,
        expected_asset: Optional[str] = None,
    ) -> Dict[str, ReceiptVerificationDetail]:
        """
        Batch-verifies multiple on-chain search receipts against Stellar Horizon.
        """
        return verify_receipts_against_horizon(
            receipts,
            horizon_url=horizon_url or self.horizon_url,
            expected_network=expected_network or self.network,
            expected_destination=expected_destination,
            expected_asset=expected_asset,
        )


class AsyncStellarSearchClient:
    """
    Asynchronous client for the StellarSearch API with automatic x402 micropayment handling.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3001",
        signer: Optional[ClientSigner] = None,
        network: str = "stellar:testnet",
        horizon_url: Optional[str] = None,
        on_payment_required: Optional[
            Callable[[PaymentChallenge], Union[bool, asyncio.Future[bool]]]
        ] = None,
        timeout_seconds: float = 30.0,
        headers: Optional[Dict[str, str]] = None,
        http_transport: Optional[HttpTransportFn] = None,
    ) -> None:
        self._sync_client = StellarSearchClient(
            base_url=base_url,
            signer=signer,
            network=network,
            horizon_url=horizon_url,
            on_payment_required=None,  # Handled asynchronously in Async client
            timeout_seconds=timeout_seconds,
            headers=headers,
            http_transport=http_transport,
        )
        self.on_payment_required = on_payment_required

    async def __aenter__(self) -> AsyncStellarSearchClient:
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        pass

    @property
    def base_url(self) -> str:
        return self._sync_client.base_url

    @property
    def network(self) -> str:
        return self._sync_client.network

    @property
    def signer(self) -> Optional[ClientSigner]:
        return self._sync_client.signer

    async def _handle_payment_approval(self, challenge: PaymentChallenge) -> None:
        if self.on_payment_required is not None:
            res = self.on_payment_required(challenge)
            if inspect.isawaitable(res):
                approved = await res
            else:
                approved = bool(res)
            if not approved:
                raise PaymentApprovalRejectedError(
                    "Payment approval rejected by on_payment_required hook",
                    challenge,
                )

    async def search(
        self,
        query: str,
        count: int = 5,
        freshness: Optional[str] = None,
        include_domains: Optional[List[str]] = None,
        exclude_domains: Optional[List[str]] = None,
        suggestions: bool = False,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
        signer: Optional[ClientSigner] = None,
        payment_header: Optional[str] = None,
    ) -> SearchResponse:
        """
        Asynchronously performs a paid web search query with Serper.dev and x402 settlement.
        """
        # If approval hook is set, test quoting/challenge first or hook into sync execution
        def run_search() -> SearchResponse:
            sync_client = self._sync_client
            # Wrap on_payment_required to synchronously handle if already resolved
            return sync_client.search(
                query=query,
                count=count,
                freshness=freshness,
                include_domains=include_domains,
                exclude_domains=exclude_domains,
                suggestions=suggestions,
                timeout_seconds=timeout_seconds,
                headers=headers,
                signer=signer,
                payment_header=payment_header,
            )

        # If on_payment_required is async, we can check quote if payment_header is not provided
        if self.on_payment_required and not payment_header:
            quote_challenge = await self.quote(
                endpoint="search",
                query=query,
                count=count,
                timeout_seconds=timeout_seconds,
                headers=headers,
            )
            if quote_challenge and quote_challenge.accepts:
                await self._handle_payment_approval(quote_challenge)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, run_search)

    async def search_images(
        self,
        query: str,
        count: int = 10,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
        signer: Optional[ClientSigner] = None,
        payment_header: Optional[str] = None,
    ) -> ImageSearchResponse:
        """
        Asynchronously performs a paid image search query.
        """
        if self.on_payment_required and not payment_header:
            quote_challenge = await self.quote(
                endpoint="images",
                query=query,
                count=count,
                timeout_seconds=timeout_seconds,
                headers=headers,
            )
            if quote_challenge and quote_challenge.accepts:
                await self._handle_payment_approval(quote_challenge)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_client.search_images(
                query=query,
                count=count,
                timeout_seconds=timeout_seconds,
                headers=headers,
                signer=signer,
                payment_header=payment_header,
            ),
        )

    async def search_news(
        self,
        query: str,
        count: int = 10,
        freshness: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
        signer: Optional[ClientSigner] = None,
        payment_header: Optional[str] = None,
    ) -> NewsSearchResponse:
        """
        Asynchronously performs a paid news search query.
        """
        if self.on_payment_required and not payment_header:
            quote_challenge = await self.quote(
                endpoint="news",
                query=query,
                count=count,
                timeout_seconds=timeout_seconds,
                headers=headers,
            )
            if quote_challenge and quote_challenge.accepts:
                await self._handle_payment_approval(quote_challenge)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_client.search_news(
                query=query,
                count=count,
                freshness=freshness,
                timeout_seconds=timeout_seconds,
                headers=headers,
                signer=signer,
                payment_header=payment_header,
            ),
        )

    async def quote(
        self,
        endpoint: str,
        query: str,
        count: int = 5,
        timeout_seconds: Optional[float] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> PaymentChallenge:
        """
        Asynchronously requests an x402 payment challenge / quote.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_client.quote(
                endpoint=endpoint,
                query=query,
                count=count,
                timeout_seconds=timeout_seconds,
                headers=headers,
            ),
        )

    async def health(self, timeout_seconds: Optional[float] = None) -> ServerHealthResponse:
        """
        Asynchronously checks server health and readiness.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_client.health(timeout_seconds=timeout_seconds),
        )

    async def get_health(self, timeout_seconds: Optional[float] = None) -> ServerHealthResponse:
        """Alias for health()."""
        return await self.health(timeout_seconds=timeout_seconds)

    async def discovery(self, timeout_seconds: Optional[float] = None) -> X402DiscoveryMetadata:
        """
        Asynchronously fetches x402 discovery metadata from /.well-known/x402.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_client.discovery(timeout_seconds=timeout_seconds),
        )

    async def get_x402_discovery(self, timeout_seconds: Optional[float] = None) -> X402DiscoveryMetadata:
        """Alias for discovery()."""
        return await self.discovery(timeout_seconds=timeout_seconds)

    async def verify_receipt(
        self,
        receipt: Union[SearchReceipt, Dict[str, Any]],
        horizon_url: Optional[str] = None,
        expected_network: Optional[str] = None,
        expected_destination: Optional[str] = None,
        expected_asset: Optional[str] = None,
        expected_amount: Optional[Union[float, str]] = None,
    ) -> ReceiptVerificationDetail:
        """
        Asynchronously verifies an on-chain search receipt against Horizon.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_client.verify_receipt(
                receipt=receipt,
                horizon_url=horizon_url,
                expected_network=expected_network,
                expected_destination=expected_destination,
                expected_asset=expected_asset,
                expected_amount=expected_amount,
            ),
        )

    async def verify_receipts(
        self,
        receipts: List[Union[SearchReceipt, Dict[str, Any]]],
        horizon_url: Optional[str] = None,
        expected_network: Optional[str] = None,
        expected_destination: Optional[str] = None,
        expected_asset: Optional[str] = None,
    ) -> Dict[str, ReceiptVerificationDetail]:
        """
        Asynchronously batch-verifies multiple receipts against Horizon.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_client.verify_receipts(
                receipts=receipts,
                horizon_url=horizon_url,
                expected_network=expected_network,
                expected_destination=expected_destination,
                expected_asset=expected_asset,
            ),
        )
