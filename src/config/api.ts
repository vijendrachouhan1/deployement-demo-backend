import type { IApiConfig } from "@/types";

/**
 * API Configuration Settings
 *
 * This configuration object contains essential settings for API.
 * These settings help protect the API from abuse and ensure
 * optimal performance.
 *
 * @typedef {Object} ApiConfig
 */
const apiConfig: IApiConfig = {
  /**
   * Rate Limiting Configuration
   *
   * @property {number} RATE_LIMIT_WINDOW_MS - Time window for rate limiting in milliseconds.
   * Defines the period during which requests are counted.
   *
   * @property {number} RATE_LIMIT_MAX_REQUESTS - Maximum number of requests allowed
   * within the rate limit window.
   *
   * @property {string} RATE_LIMIT_DEFAULT_MESSAGE - Error message returned when
   * rate limit is exceeded. This message will be sent to clients who have
   * exceeded their request quota.
   */
  RATE_LIMIT_WINDOW_MS: 60000, // (60000ms = 1 minute)
  RATE_LIMIT_MAX_REQUESTS: 100,
  RATE_LIMIT_DEFAULT_MESSAGE: "Too many requests, please try again later.",

  /**
   * API Payload Size Limits
   *
   * @property {string} API_MAX_PAYLOAD_SIZE - Maximum size for JSON/raw request bodies.
   * Limits the size of incoming request payloads to prevent memory issues
   * and potential DoS attacks.
   *
   * @property {string} API_MAX_URL_ENCODED_SIZE - Maximum size for URL-encoded data.
   * Limits the size of URL-encoded form submissions and query strings.
   */
  API_MAX_PAYLOAD_SIZE: "100kb",
  API_MAX_URL_ENCODED_SIZE: "100kb",
};

export default apiConfig;
