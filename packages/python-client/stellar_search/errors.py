"""
Errors for the stellar_search package.
"""

from typing import Any, Optional


class StellarSearchError(Exception):
    """
    Base exception for all stellar_search errors.
    """

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        details: Any = None,
        cause: Optional[Exception] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details
        self.cause = cause
        if cause is not None:
            self.__cause__ = cause

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(message={self.message!r}, status_code={self.status_code!r})"


class ValidationError(StellarSearchError):
    """
    Raised when client-side parameter validation fails before sending a request.
    """

    def __init__(self, message: str, details: Any = None) -> None:
        super().__init__(message=message, status_code=400, details=details)


class PaymentRequiredError(StellarSearchError):
    """
    Raised when an endpoint requires an x402 payment and no signer was provided
    to settle it, or when an unfulfilled challenge is returned.
    """

    def __init__(self, message: str, challenge: Any = None) -> None:
        super().__init__(message=message, status_code=402, details=challenge)
        self.challenge = challenge


class PaymentApprovalRejectedError(StellarSearchError):
    """
    Raised when the explicit user approval callback (on_payment_required)
    rejects the payment challenge.
    """

    def __init__(self, message: str, challenge: Any = None) -> None:
        super().__init__(message=message, status_code=402, details=challenge)
        self.challenge = challenge


class PaymentFailedError(StellarSearchError):
    """
    Raised when a paid request retry fails after presenting payment credentials.
    """

    def __init__(
        self,
        message: str,
        status_code: int = 402,
        server_error: Optional[str] = None,
        details: Any = None,
    ) -> None:
        super().__init__(message=message, status_code=status_code, details=details)
        self.server_error = server_error


class VerificationError(StellarSearchError):
    """
    Raised when on-chain receipt verification fails.
    """

    def __init__(self, message: str, details: Any = None) -> None:
        super().__init__(message=message, status_code=None, details=details)
