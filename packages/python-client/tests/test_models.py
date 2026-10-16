"""
Unit tests for data models serialization and deserialization.
"""

import os
import sys
import unittest

_PACKAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PACKAGE_DIR not in sys.path:
    sys.path.insert(0, _PACKAGE_DIR)

from stellar_search.models import (
    AnswerBox,
    AnswerBoxSource,
    ImageResult,
    ImageSearchResponse,
    KnowledgeGraph,
    KnowledgeGraphAttribute,
    KnowledgeGraphLink,
    NewsResult,
    NewsSearchResponse,
    ReceiptVerificationDetail,
    SearchReceipt,
    SearchResponse,
    SearchResult,
    ServerHealthResponse,
    X402DiscoveryMetadata,
)
from tests.fixtures import (
    SAMPLE_DISCOVERY_METADATA_DICT,
    SAMPLE_HEALTH_RESPONSE_DICT,
    SAMPLE_IMAGE_RESPONSE_DICT,
    SAMPLE_NEWS_RESPONSE_DICT,
    SAMPLE_SEARCH_RESPONSE_DICT,
)


class TestModels(unittest.TestCase):
    def test_search_result_and_response(self) -> None:
        resp = SearchResponse.from_dict(SAMPLE_SEARCH_RESPONSE_DICT)
        self.assertEqual(resp.query, "stellar blockchain")
        self.assertEqual(resp.count, 1)
        self.assertEqual(resp.network, "stellar:testnet")
        self.assertEqual(resp.paid_amount, "0.001")
        self.assertEqual(resp.currency, "USDC")
        self.assertEqual(len(resp.results), 1)

        result = resp.results[0]
        self.assertEqual(result.id, "1")
        self.assertEqual(result.title, "Stellar Docs")
        self.assertEqual(result.url, "https://developers.stellar.org")
        self.assertEqual(result.relevance_score, 0.98)

        data = resp.to_dict()
        self.assertIsInstance(data, dict)
        self.assertEqual(data["query"], "stellar blockchain")

    def test_answer_box_and_knowledge_graph(self) -> None:
        raw = {
            "query": "stellar definition",
            "results": [],
            "count": 0,
            "network": "stellar:testnet",
            "paidAmount": "0.001",
            "currency": "USDC",
            "latencyMs": 50,
            "answerBox": {
                "title": "Stellar",
                "answer": "An open network for storing and moving money.",
                "source": {
                    "title": "Stellar.org",
                    "link": "https://stellar.org",
                    "displayLink": "stellar.org",
                },
            },
            "knowledgeGraph": {
                "title": "Stellar",
                "type": "Protocol",
                "description": "Decentralized payment protocol",
                "attributes": [{"name": "Founder", "value": "Jed McCaleb"}],
                "links": [{"title": "Official site", "link": "https://stellar.org"}],
            },
        }
        resp = SearchResponse.from_dict(raw)
        self.assertIsNotNone(resp.answer_box)
        assert resp.answer_box is not None
        self.assertEqual(resp.answer_box.title, "Stellar")
        self.assertEqual(resp.answer_box.source.title, "Stellar.org")

        self.assertIsNotNone(resp.knowledge_graph)
        assert resp.knowledge_graph is not None
        self.assertEqual(resp.knowledge_graph.title, "Stellar")
        self.assertEqual(len(resp.knowledge_graph.attributes), 1)
        self.assertEqual(resp.knowledge_graph.attributes[0].name, "Founder")

    def test_image_search_response(self) -> None:
        resp = ImageSearchResponse.from_dict(SAMPLE_IMAGE_RESPONSE_DICT)
        self.assertEqual(resp.query, "stellar logo")
        self.assertEqual(len(resp.results), 1)
        img = resp.results[0]
        self.assertEqual(img.id, "img1")
        self.assertEqual(img.image_url, "https://example.com/logo.png")
        self.assertEqual(img.width, 800)
        self.assertEqual(img.height, 600)

    def test_news_search_response(self) -> None:
        resp = NewsSearchResponse.from_dict(SAMPLE_NEWS_RESPONSE_DICT)
        self.assertEqual(resp.query, "stellar updates")
        self.assertEqual(len(resp.results), 1)
        news = resp.results[0]
        self.assertEqual(news.id, "news1")
        self.assertEqual(news.title, "Stellar Protocol 22 Announcement")
        self.assertEqual(news.source, "example.com")

    def test_receipt_models(self) -> None:
        receipt = SearchReceipt.from_dict(
            {
                "txHash": "hash123",
                "query": "stellar payments",
                "amount": "0.001",
                "timestamp": "2026-09-01T12:00:00Z",
                "network": "stellar:testnet",
            }
        )
        self.assertEqual(receipt.tx_hash, "hash123")
        self.assertEqual(receipt.amount, "0.001")

        detail = ReceiptVerificationDetail.from_dict(
            {
                "status": "confirmed",
                "txHash": "hash123",
                "ledgerSequence": 12345,
                "verifiedAt": "2026-09-01T12:00:05Z",
            }
        )
        self.assertEqual(detail.status, "confirmed")
        self.assertEqual(detail.ledger_sequence, 12345)

    def test_health_and_discovery_models(self) -> None:
        health = ServerHealthResponse.from_dict(SAMPLE_HEALTH_RESPONSE_DICT)
        self.assertEqual(health.status, "ok")
        self.assertEqual(health.price_per_query, "0.001 USDC")
        self.assertTrue(health.serper_api_configured)

        disc = X402DiscoveryMetadata.from_dict(SAMPLE_DISCOVERY_METADATA_DICT)
        self.assertEqual(disc.protocol, "x402")
        self.assertEqual(len(disc.resource_templates), 1)
        tmpl = disc.resource_templates[0]
        self.assertEqual(tmpl.resource, "/search")
        self.assertEqual(len(tmpl.accepts), 1)
        self.assertEqual(tmpl.accepts[0].amount, "10000")


if __name__ == "__main__":
    unittest.main()
