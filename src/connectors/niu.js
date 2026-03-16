const BaseConnector = require('./base');
const config = require('../config');
const { logger } = require('../audit/logger');

class NiuConnector extends BaseConnector {
  constructor() {
    super('NIU');
  }

  async verify(normalizedValue, issuerCountry, correlationId) {
    this.stats.total++;

    try {
      // Dynamic import for fetch (Node 18+ has built-in fetch)
      const url = new URL(config.niu.apiUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.niu.apiTimeout);

      let response;
      try {
        response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'node': 'niu',
            'key': normalizedValue,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      let body;
      try {
        body = await response.json();
      } catch {
        body = { ok: false, message: 'Invalid response from registry' };
      }

      // Map response to IVS status categories
      // NEVER log raw identifier value
      logger.info('[NIU_CONNECTOR] Registry response received', {
        correlation_id: correlationId,
        http_status: response.status,
        registry_ok: body.ok,
        issuer_country: issuerCountry,
      });

      if (body.ok === true && response.status >= 200 && response.status < 300) {
        // Successful verification
        const confirmedAttributes = {};
        if (body.data) {
          if (body.data.full_name || body.data.nom) {
            confirmedAttributes.full_name = (body.data.full_name || body.data.nom || '').toUpperCase();
          }
          if (body.data.date_of_birth || body.data.date_naissance) {
            confirmedAttributes.date_of_birth = body.data.date_of_birth || body.data.date_naissance;
          }
          if (body.data.address || body.data.adresse) {
            confirmedAttributes.address = body.data.address || body.data.adresse;
          }
        }

        this.stats.verified++;
        this.healthy = true;
        this.lastCheck = new Date().toISOString();
        return {
          status: 'verified',
          confirmed_attributes: confirmedAttributes,
          source_registry: 'NIU',
        };
      }

      // Non-successful outcomes
      if (response.status === 400) {
        // "Aucune information n'est disponible" or similar
        this.stats.not_found++;
        this.healthy = true;
        this.lastCheck = new Date().toISOString();
        return {
          status: 'not_found',
          message: body.message || 'No information available',
          source_registry: 'NIU',
        };
      }

      if (response.status === 422 || response.status === 404) {
        this.stats.invalid++;
        this.healthy = true;
        this.lastCheck = new Date().toISOString();
        return {
          status: 'invalid',
          message: body.message || 'Invalid identifier',
          source_registry: 'NIU',
        };
      }

      if (response.status >= 500) {
        this.stats.registry_unavailable++;
        this.healthy = false;
        this.lastCheck = new Date().toISOString();
        return {
          status: 'registry_unavailable',
          message: 'NIU registry returned server error',
          source_registry: 'NIU',
        };
      }

      // Default: inconclusive
      this.stats.inconclusive++;
      this.lastCheck = new Date().toISOString();
      return {
        status: 'inconclusive',
        message: body.message || 'Unexpected response from registry',
        source_registry: 'NIU',
      };

    } catch (err) {
      this.stats.registry_unavailable++;
      this.stats.errors++;
      this.healthy = false;
      this.lastCheck = new Date().toISOString();

      logger.error('[NIU_CONNECTOR] Registry call failed', {
        correlation_id: correlationId,
        error: err.message,
      });

      return {
        status: 'registry_unavailable',
        message: `NIU registry unreachable: ${err.message}`,
        source_registry: 'NIU',
      };
    }
  }

  async healthCheck() {
    return {
      name: this.name,
      healthy: this.healthy,
      lastCheck: this.lastCheck,
      stats: this.getStats(),
    };
  }
}

module.exports = NiuConnector;
