# Search progress accessibility

The payment-flow container exposes `role="status"`, announces concise phase
changes through `aria-live="polite"`, and reports `aria-busy` only while a
search is active. Decorative step animation is hidden from assistive
technology so users hear status changes rather than repeated visual details.
