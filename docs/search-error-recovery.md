# Search error recovery

The browser search flow records a stable `errorCode` on failed requests. The
Search page uses it to offer the most relevant next action: wallet/network
errors route to connection guidance, balance errors start a fresh flow, and
provider or request failures offer a retry for the same query. A retry only
starts a new payment flow after the previous request has failed; the existing
cross-tab search lock continues to prevent concurrent duplicate payments.
