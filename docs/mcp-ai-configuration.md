# MCP AI configuration

The MCP server does not construct a Groq client during startup. The client is
created only when `ai_summarize` runs and a `GROQ_API_KEY` is configured.
Non-AI tools such as `check_balance` and `get_search_stats` therefore remain
available when the optional AI key is absent.
