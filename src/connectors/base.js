/**
 * Base connector interface.
 * All registry connectors must implement this pattern.
 */
class BaseConnector {
  constructor(name) {
    this.name = name;
    this.healthy = true;
    this.lastCheck = null;
    this.stats = {
      total: 0,
      verified: 0,
      not_found: 0,
      invalid: 0,
      registry_unavailable: 0,
      inconclusive: 0,
      format_error: 0,
      errors: 0,
    };
  }

  /**
   * Verify an identifier against the registry.
   * Must return: { status, confirmed_attributes?, raw_response_code?, message? }
   * Status must be one of: verified, not_found, invalid, registry_unavailable, inconclusive, format_error
   */
  async verify(_normalizedValue, _issuerCountry, _correlationId) {
    throw new Error('verify() must be implemented by subclass');
  }

  /**
   * Health check for this connector.
   */
  async healthCheck() {
    return { healthy: this.healthy, name: this.name, lastCheck: this.lastCheck };
  }

  recordResult(status) {
    this.stats.total++;
    if (this.stats[status] !== undefined) {
      this.stats[status]++;
    }
    this.lastCheck = new Date().toISOString();
  }

  getStats() {
    return { ...this.stats, name: this.name, healthy: this.healthy, lastCheck: this.lastCheck };
  }
}

module.exports = BaseConnector;
