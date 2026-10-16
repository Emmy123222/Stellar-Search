"""
stellar_search — Typed Python client SDK for paid search with x402 on Stellar.
"""

from .client import AsyncStellarSearchClient, StellarSearchClient
from .errors import (
    PaymentApprovalRejectedError,
    PaymentFailedError,
    PaymentRequiredError,
    StellarSearchError,
    ValidationError,
    VerificationError,
)
from .models import (
    AnswerBox,
    AnswerBoxSource,
    ImageResult,
    ImageSearchResponse,
    KnowledgeGraph,
    KnowledgeGraphAttribute,
    KnowledgeGraphLink,
    NewsResult,
    NewsSearchResponse,
    PaymentAcceptOption,
    PaymentChallenge,
    ReceiptVerificationDetail,
    SearchReceipt,
    SearchResponse,
    SearchResult,
    ServerHealthResponse,
    SignedPaymentHeader,
    SignerContext,
    X402DiscoveryMetadata,
    X402PaymentOption,
    X402ResourceTemplate,
)
from .signers import (
    ClientSigner,
    MockSigner,
    ServerSigner,
    create_server_signer,
)
from .verification import (
    HORIZON_MAINNET,
    HORIZON_TESTNET,
    get_horizon_url_for_network,
    verify_receipt_against_horizon,
    verify_receipts_against_horizon,
)
from .x402 import (
    encode_payment_headers,
    extract_settlement_response,
    parse_payment_challenge,
    redact_secret,
)

__version__ = "1.0.0"

__all__ = [
    # Clients
    "StellarSearchClient",
    "AsyncStellarSearchClient",
    # Models
    "AnswerBox",
    "AnswerBoxSource",
    "ImageResult",
    "ImageSearchResponse",
    "KnowledgeGraph",
    "KnowledgeGraphAttribute",
    "KnowledgeGraphLink",
    "NewsResult",
    "NewsSearchResponse",
    "PaymentAcceptOption",
    "PaymentChallenge",
    "ReceiptVerificationDetail",
    "SearchReceipt",
    "SearchResponse",
    "SearchResult",
    "ServerHealthResponse",
    "SignedPaymentHeader",
    "SignerContext",
    "X402DiscoveryMetadata",
    "X402PaymentOption",
    "X402ResourceTemplate",
    # Errors
    "StellarSearchError",
    "ValidationError",
    "PaymentRequiredError",
    "PaymentApprovalRejectedError",
    "PaymentFailedError",
    "VerificationError",
    # Signers
    "ClientSigner",
    "MockSigner",
    "ServerSigner",
    "create_server_signer",
    # Verification
    "HORIZON_MAINNET",
    "HORIZON_TESTNET",
    "get_horizon_url_for_network",
    "verify_receipt_against_horizon",
    "verify_receipts_against_horizon",
    # x402
    "encode_payment_headers",
    "extract_settlement_response",
    "parse_payment_challenge",
    "redact_secret",
]
