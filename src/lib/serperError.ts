import { SerperErrorCode, type ApiErrorResponse } from '../types/index.js'

export interface SerperErrorResult {
  httpStatus: number
  body: ApiErrorResponse
}

const ERROR_LABELS: Record<SerperErrorCode, string> = {
  [SerperErrorCode.AUTH_FAILURE]:   'Serper API key is invalid or missing',
  [SerperErrorCode.QUOTA_EXCEEDED]: 'Serper API quota has been exceeded',
  [SerperErrorCode.RATE_LIMITED]:   'Serper rate limit exceeded',
  [SerperErrorCode.PROVIDER_ERROR]: 'Serper returned a server error',
  [SerperErrorCode.NETWORK_ERROR]:  'Unable to reach Serper API',
}

export function mapSerperStatus(status: number): SerperErrorResult {
  let code: SerperErrorCode
  let httpStatus: number

  switch (status) {
    case 401:
      code = SerperErrorCode.AUTH_FAILURE
      httpStatus = 503
      break
    case 403:
      code = SerperErrorCode.QUOTA_EXCEEDED
      httpStatus = 503
      break
    case 429:
      code = SerperErrorCode.RATE_LIMITED
      httpStatus = 429
      break
    default:
      code = SerperErrorCode.PROVIDER_ERROR
      httpStatus = 502
      break
  }

  return {
    httpStatus,
    body: {
      error:       ERROR_LABELS[code],
      providerCode: code,
    },
  }
}

export function mapSerperNetworkError(): SerperErrorResult {
  return {
    httpStatus: 502,
    body: {
      error:       ERROR_LABELS[SerperErrorCode.NETWORK_ERROR],
      providerCode: SerperErrorCode.NETWORK_ERROR,
    },
  }
}
