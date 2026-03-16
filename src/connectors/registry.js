const NiuConnector = require('./niu');

/**
 * Connector registry: routes verification requests to the correct connector
 * based on identifier type and issuer country.
 */
class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // NIU connector is currently the only available one
    this.connectors.set('NIU', new NiuConnector());
  }

  getConnector(identifierType, _issuerCountry) {
    return this.connectors.get(identifierType) || null;
  }

  hasConnector(identifierType) {
    return this.connectors.has(identifierType);
  }

  async getAllHealth() {
    const results = {};
    for (const [type, connector] of this.connectors) {
      results[type] = await connector.healthCheck();
    }
    return results;
  }

  getAllStats() {
    const stats = {};
    for (const [type, connector] of this.connectors) {
      stats[type] = connector.getStats();
    }
    return stats;
  }
}

module.exports = new ConnectorRegistry();
