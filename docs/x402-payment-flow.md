# x402 Payment Flow and Response Headers

Stellar search handles x402 payment integrity by checking both response payload bodies and the `x-payment-response` middleware response header for settlement metadata such as transaction references and paid amounts.
