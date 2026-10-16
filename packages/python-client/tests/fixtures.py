"""
Offline fixtures for stellar_search tests.
"""

from typing import Any, Dict

MOCK_CHALLENGE_DICT: Dict[str, Any] = {
    "x402Version": 2,
    "error": "Payment required",
    "resource": {
        "url": "/search",
        "description": "Serper web search",
    },
    "accepts": [
        {
            "scheme": "exact",
            "network": "stellar:testnet",
            "amount": "10000",
            "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
            "payTo": "GBBD47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA",
            "maxTimeoutSeconds": 300,
        }
    ],
}

SAMPLE_SEARCH_RESPONSE_DICT: Dict[str, Any] = {
    "query": "stellar blockchain",
    "results": [
        {
            "id": "1",
            "title": "Stellar Docs",
            "url": "https://developers.stellar.org",
            "description": "Developer resources for Stellar",
            "source": "developers.stellar.org",
            "relevanceScore": 0.98,
            "publishedAt": "2026-01-15",
        }
    ],
    "count": 1,
    "network": "stellar:testnet",
    "paidAmount": "0.001",
    "currency": "USDC",
    "txHash": "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
    "latencyMs": 85,
    "suggestions": ["stellar consensus protocol", "stellar smart contracts"],
}

SAMPLE_IMAGE_RESPONSE_DICT: Dict[str, Any] = {
    "query": "stellar logo",
    "results": [
        {
            "id": "img1",
            "title": "Stellar Rocket Logo",
            "imageUrl": "https://example.com/logo.png",
            "thumbnailUrl": "https://example.com/thumb.png",
            "sourceUrl": "https://example.com",
            "source": "example.com",
            "width": 800,
            "height": 600,
        }
    ],
    "count": 1,
    "network": "stellar:testnet",
    "paidAmount": "0.001",
    "currency": "USDC",
    "txHash": "imageTxHash1234567890abcdef1234567890abcdef1234567890abcdef1234",
    "latencyMs": 95,
}

SAMPLE_NEWS_RESPONSE_DICT: Dict[str, Any] = {
    "query": "stellar updates",
    "results": [
        {
            "id": "news1",
            "title": "Stellar Protocol 22 Announcement",
            "url": "https://example.com/news/p22",
            "snippet": "Stellar network announces Protocol 22 release",
            "source": "example.com",
            "publishedAt": "2026-09-01",
        }
    ],
    "count": 1,
    "network": "stellar:testnet",
    "paidAmount": "0.001",
    "currency": "USDC",
    "txHash": "newsTxHash1234567890abcdef1234567890abcdef1234567890abcdef12345",
    "latencyMs": 110,
}

SAMPLE_HEALTH_RESPONSE_DICT: Dict[str, Any] = {
    "status": "ok",
    "network": "stellar:testnet",
    "pricePerQuery": "0.001 USDC",
    "protocol": "x402",
    "facilitator": "https://www.x402.org/facilitator",
    "totalQueries": 1250,
    "totalUsdcSettled": "1.25",
    "avgLatencyMs": 120.5,
    "uptime": "99.98%",
    "serperApiConfigured": True,
    "receivingAddressConfigured": True,
}

SAMPLE_DISCOVERY_METADATA_DICT: Dict[str, Any] = {
    "version": 1,
    "protocol": "x402",
    "networks": ["stellar:testnet", "stellar:mainnet"],
    "assets": ["USDC"],
    "schemes": ["exact"],
    "priceDiscoveryUrl": "https://example.com/.well-known/x402",
    "resourceTemplates": [
        {
            "id": "web-search",
            "resource": "/search",
            "method": "GET",
            "description": "Serper web search",
            "accepts": [
                {
                    "scheme": "exact",
                    "network": "stellar:testnet",
                    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
                    "amount": "10000",
                    "price": "0.001",
                    "currency": "USDC",
                    "payTo": "GBBD47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA",
                }
            ],
        }
    ],
}
