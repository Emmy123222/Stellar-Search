"""
Data models and typed structures for stellar_search.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Union


# ─── Answer Box & Knowledge Graph ───────────────────────────────────────────


@dataclass
class AnswerBoxSource:
    title: str
    link: str
    display_link: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AnswerBoxSource:
        return cls(
            title=str(data.get("title", "")),
            link=str(data.get("link", "")),
            display_link=data.get("displayLink") or data.get("display_link"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AnswerBox:
    title: str
    answer: str
    source: AnswerBoxSource

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AnswerBox:
        src = data.get("source") or {}
        return cls(
            title=str(data.get("title", "")),
            answer=str(data.get("answer", "")),
            source=AnswerBoxSource.from_dict(src) if isinstance(src, dict) else AnswerBoxSource(title="", link=""),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class KnowledgeGraphAttribute:
    name: str
    value: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> KnowledgeGraphAttribute:
        return cls(
            name=str(data.get("name", "")),
            value=str(data.get("value", "")),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class KnowledgeGraphLink:
    title: str
    link: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> KnowledgeGraphLink:
        return cls(
            title=str(data.get("title", "")),
            link=str(data.get("link", "")),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class KnowledgeGraph:
    title: str
    type: Optional[str] = None
    description: Optional[str] = None
    attributes: List[KnowledgeGraphAttribute] = field(default_factory=list)
    image_url: Optional[str] = None
    website: Optional[str] = None
    links: List[KnowledgeGraphLink] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> KnowledgeGraph:
        attrs = [
            KnowledgeGraphAttribute.from_dict(a)
            for a in data.get("attributes", [])
            if isinstance(a, dict)
        ]
        links = [
            KnowledgeGraphLink.from_dict(l)
            for l in data.get("links", [])
            if isinstance(l, dict)
        ]
        return cls(
            title=str(data.get("title", "")),
            type=data.get("type"),
            description=data.get("description"),
            attributes=attrs,
            image_url=data.get("imageUrl") or data.get("image_url"),
            website=data.get("website"),
            links=links,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─── Search Result Items ────────────────────────────────────────────────────


@dataclass
class SearchResult:
    id: str
    title: str
    url: str
    description: str
    source: str
    relevance_score: float
    published_at: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> SearchResult:
        score_raw = data.get("relevanceScore") if "relevanceScore" in data else data.get("relevance_score", 1.0)
        try:
            score = float(score_raw)
        except (ValueError, TypeError):
            score = 1.0

        return cls(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            url=str(data.get("url", "")),
            description=str(data.get("description", "")),
            source=str(data.get("source", "")),
            relevance_score=score,
            published_at=data.get("publishedAt") or data.get("published_at"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ImageResult:
    id: str
    title: str
    image_url: str
    thumbnail_url: str
    source_url: str
    source: str
    width: Optional[int] = None
    height: Optional[int] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ImageResult:
        return cls(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            image_url=str(data.get("imageUrl") or data.get("image_url", "")),
            thumbnail_url=str(data.get("thumbnailUrl") or data.get("thumbnail_url", "")),
            source_url=str(data.get("sourceUrl") or data.get("source_url", "")),
            source=str(data.get("source", "")),
            width=data.get("width"),
            height=data.get("height"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class NewsResult:
    id: str
    title: str
    url: str
    snippet: str
    source: str
    published_at: Optional[str] = None
    image_url: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> NewsResult:
        return cls(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            url=str(data.get("url", "")),
            snippet=str(data.get("snippet", "")),
            source=str(data.get("source", "")),
            published_at=data.get("publishedAt") or data.get("published_at"),
            image_url=data.get("imageUrl") or data.get("image_url"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─── API Responses ──────────────────────────────────────────────────────────


@dataclass
class SearchResponse:
    query: str
    results: List[SearchResult]
    count: int
    network: str
    paid_amount: str
    currency: str
    latency_ms: int
    tx_hash: Optional[str] = None
    original_query: Optional[str] = None
    executed_query: Optional[str] = None
    suggested_query: Optional[str] = None
    is_corrected: Optional[bool] = None
    answer_box: Optional[AnswerBox] = None
    knowledge_graph: Optional[KnowledgeGraph] = None
    suggestions: List[str] = field(default_factory=list)
    filters: Optional[Dict[str, List[str]]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> SearchResponse:
        results = [
            SearchResult.from_dict(item)
            for item in data.get("results", [])
            if isinstance(item, dict)
        ]
        ab_data = data.get("answerBox") or data.get("answer_box")
        answer_box = AnswerBox.from_dict(ab_data) if isinstance(ab_data, dict) else None

        kg_data = data.get("knowledgeGraph") or data.get("knowledge_graph")
        knowledge_graph = KnowledgeGraph.from_dict(kg_data) if isinstance(kg_data, dict) else None

        return cls(
            query=str(data.get("query", "")),
            results=results,
            count=int(data.get("count", len(results))),
            network=str(data.get("network", "")),
            paid_amount=str(data.get("paidAmount") or data.get("paid_amount", "0")),
            currency=str(data.get("currency", "USDC")),
            latency_ms=int(data.get("latencyMs") or data.get("latency_ms", 0)),
            tx_hash=data.get("txHash") or data.get("tx_hash"),
            original_query=data.get("originalQuery") or data.get("original_query"),
            executed_query=data.get("executedQuery") or data.get("executed_query"),
            suggested_query=data.get("suggestedQuery") or data.get("suggested_query"),
            is_corrected=data.get("isCorrected") if "isCorrected" in data else data.get("is_corrected"),
            answer_box=answer_box,
            knowledge_graph=knowledge_graph,
            suggestions=list(data.get("suggestions", [])),
            filters=data.get("filters"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ImageSearchResponse:
    query: str
    results: List[ImageResult]
    count: int
    network: str
    paid_amount: str
    currency: str
    latency_ms: int
    tx_hash: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ImageSearchResponse:
        results = [
            ImageResult.from_dict(item)
            for item in data.get("results", [])
            if isinstance(item, dict)
        ]
        return cls(
            query=str(data.get("query", "")),
            results=results,
            count=int(data.get("count", len(results))),
            network=str(data.get("network", "")),
            paid_amount=str(data.get("paidAmount") or data.get("paid_amount", "0")),
            currency=str(data.get("currency", "USDC")),
            latency_ms=int(data.get("latencyMs") or data.get("latency_ms", 0)),
            tx_hash=data.get("txHash") or data.get("tx_hash"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class NewsSearchResponse:
    query: str
    results: List[NewsResult]
    count: int
    network: str
    paid_amount: str
    currency: str
    latency_ms: int
    tx_hash: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> NewsSearchResponse:
        results = [
            NewsResult.from_dict(item)
            for item in data.get("results", [])
            if isinstance(item, dict)
        ]
        return cls(
            query=str(data.get("query", "")),
            results=results,
            count=int(data.get("count", len(results))),
            network=str(data.get("network", "")),
            paid_amount=str(data.get("paidAmount") or data.get("paid_amount", "0")),
            currency=str(data.get("currency", "USDC")),
            latency_ms=int(data.get("latencyMs") or data.get("latency_ms", 0)),
            tx_hash=data.get("txHash") or data.get("tx_hash"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─── Receipts & On-Chain Verification ───────────────────────────────────────


@dataclass
class SearchReceipt:
    tx_hash: str
    query: str
    amount: str
    timestamp: str
    network: str
    asset: Optional[str] = None
    destination: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> SearchReceipt:
        return cls(
            tx_hash=str(data.get("txHash") or data.get("tx_hash", "")),
            query=str(data.get("query", "")),
            amount=str(data.get("amount", "")),
            timestamp=str(data.get("timestamp", "")),
            network=str(data.get("network", "")),
            asset=data.get("asset"),
            destination=data.get("destination"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ReceiptVerificationDetail:
    status: str  # 'confirmed' | 'mismatched' | 'unverified'
    tx_hash: Optional[str] = None
    network: Optional[str] = None
    ledger_sequence: Optional[int] = None
    verified_at: Optional[str] = None
    asset: Optional[str] = None
    amount: Optional[str] = None
    destination: Optional[str] = None
    mismatches: List[str] = field(default_factory=list)
    error: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ReceiptVerificationDetail:
        return cls(
            status=str(data.get("status", "unverified")),
            tx_hash=data.get("txHash") or data.get("tx_hash"),
            network=data.get("network"),
            ledger_sequence=data.get("ledgerSequence") or data.get("ledger_sequence"),
            verified_at=data.get("verifiedAt") or data.get("verified_at"),
            asset=data.get("asset"),
            amount=data.get("amount"),
            destination=data.get("destination"),
            mismatches=list(data.get("mismatches", [])),
            error=data.get("error"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─── x402 Protocol Types ────────────────────────────────────────────────────


@dataclass
class PaymentAcceptOption:
    scheme: str
    network: str
    amount: str
    asset: str
    pay_to: str
    max_timeout_seconds: Optional[int] = None
    extra: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> PaymentAcceptOption:
        return cls(
            scheme=str(data.get("scheme", "exact")),
            network=str(data.get("network", "stellar:testnet")),
            amount=str(data.get("amount", "10000")),
            asset=str(data.get("asset", "")),
            pay_to=str(data.get("payTo") or data.get("pay_to", "")),
            max_timeout_seconds=data.get("maxTimeoutSeconds") or data.get("max_timeout_seconds"),
            extra=data.get("extra") if isinstance(data.get("extra"), dict) else None,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PaymentChallenge:
    accepts: List[PaymentAcceptOption]
    x402_version: Optional[Any] = 2
    error: Optional[str] = "Payment required"
    resource: Optional[Dict[str, Any]] = None
    raw_header: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any], raw_header: Optional[str] = None) -> PaymentChallenge:
        accepts_raw = data.get("accepts", [])
        accepts = [
            PaymentAcceptOption.from_dict(opt)
            for opt in accepts_raw
            if isinstance(opt, dict)
        ]
        return cls(
            accepts=accepts,
            x402_version=data.get("x402Version") or data.get("x402_version", 2),
            error=data.get("error", "Payment required"),
            resource=data.get("resource"),
            raw_header=raw_header or data.get("rawHeader") or data.get("raw_header"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SignedPaymentHeader:
    header_name: str
    header_value: str
    secondary_headers: Optional[Dict[str, str]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SignerContext:
    url: str
    method: str
    network: str
    challenge: PaymentChallenge


# ─── Discovery & Health ─────────────────────────────────────────────────────


@dataclass
class X402PaymentOption:
    scheme: str
    network: str
    asset: str
    amount: str
    price: str
    currency: str
    pay_to: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> X402PaymentOption:
        return cls(
            scheme=str(data.get("scheme", "exact")),
            network=str(data.get("network", "")),
            asset=str(data.get("asset", "")),
            amount=str(data.get("amount", "")),
            price=str(data.get("price", "")),
            currency=str(data.get("currency", "USDC")),
            pay_to=data.get("payTo") or data.get("pay_to"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class X402ResourceTemplate:
    id: str
    resource: str
    method: str
    description: str
    accepts: List[X402PaymentOption]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> X402ResourceTemplate:
        accepts = [
            X402PaymentOption.from_dict(a)
            for a in data.get("accepts", [])
            if isinstance(a, dict)
        ]
        return cls(
            id=str(data.get("id", "")),
            resource=str(data.get("resource", "")),
            method=str(data.get("method", "GET")),
            description=str(data.get("description", "")),
            accepts=accepts,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class X402DiscoveryMetadata:
    version: int
    protocol: str
    resource_templates: List[X402ResourceTemplate]
    networks: List[str]
    assets: List[str]
    schemes: List[str]
    price_discovery_url: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> X402DiscoveryMetadata:
        templates = [
            X402ResourceTemplate.from_dict(t)
            for t in data.get("resourceTemplates") or data.get("resource_templates", [])
            if isinstance(t, dict)
        ]
        return cls(
            version=int(data.get("version", 1)),
            protocol=str(data.get("protocol", "x402")),
            resource_templates=templates,
            networks=list(data.get("networks", [])),
            assets=list(data.get("assets", [])),
            schemes=list(data.get("schemes", [])),
            price_discovery_url=str(data.get("priceDiscoveryUrl") or data.get("price_discovery_url", "")),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ServerHealthResponse:
    status: str
    network: str
    price_per_query: str
    protocol: str
    facilitator: Optional[str] = None
    total_queries: Optional[int] = None
    total_usdc_settled: Optional[str] = None
    avg_latency_ms: Optional[float] = None
    uptime: Optional[str] = None
    checks: Optional[Dict[str, Any]] = None
    readiness: Optional[Dict[str, Any]] = None
    serper_api_configured: Optional[bool] = None
    groq_api_configured: Optional[bool] = None
    receiving_address_configured: Optional[bool] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ServerHealthResponse:
        return cls(
            status=str(data.get("status", "unknown")),
            network=str(data.get("network", "")),
            price_per_query=str(data.get("pricePerQuery") or data.get("price_per_query", "")),
            protocol=str(data.get("protocol", "x402")),
            facilitator=data.get("facilitator"),
            total_queries=data.get("totalQueries") or data.get("total_queries"),
            total_usdc_settled=data.get("totalUsdcSettled") or data.get("total_usdc_settled"),
            avg_latency_ms=data.get("avgLatencyMs") or data.get("avg_latency_ms"),
            uptime=data.get("uptime"),
            checks=data.get("checks"),
            readiness=data.get("readiness"),
            serper_api_configured=data.get("serperApiConfigured") if "serperApiConfigured" in data else data.get("serper_api_configured"),
            groq_api_configured=data.get("groqApiConfigured") if "groqApiConfigured" in data else data.get("groq_api_configured"),
            receiving_address_configured=data.get("receivingAddressConfigured") if "receivingAddressConfigured" in data else data.get("receiving_address_configured"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
