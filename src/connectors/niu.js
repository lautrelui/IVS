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
        // Successful verification — normalize demographic attributes.
        // The registry may nest attributes under body.data, body.data.attributes,
        // body.result, or return them at the top level of body itself.
        const rawAttrs = body.data?.data || body.data?.attributes || body.data || body.result || body;

        // Log the raw keys so we can diagnose field-name mismatches
        logger.info('[NIU_CONNECTOR] Registry data keys', {
          correlation_id: correlationId,
          data_keys: body.data ? Object.keys(body.data) : null,
          nested_data_keys: body.data?.data ? Object.keys(body.data.data).slice(0, 15) : null,
          nested_attr_keys: body.data?.attributes ? Object.keys(body.data.attributes) : null,
          raw_attrs_keys: rawAttrs ? Object.keys(rawAttrs).slice(0, 15) : null,
        });

        const confirmedAttributes = this._normalizeAttributes(rawAttrs);

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

  /**
   * Normalize demographic attributes returned by the NIU registry.
   * Registry fields (French or English) are mapped to a canonical schema:
   *   givennames / prenom   → first_name
   *   surnames  / nom       → last_name
   *   full_name (or derived) → full_name = first_name + " " + last_name
   *   dateOfBirth / date_naissance → date_of_birth (ISO YYYY-MM-DD)
   *   sex / sexe            → sex (M/F)
   *   nationality / nationalite → nationality (as-is, e.g. ISO alpha-3)
   *   placeOfBirth / lieu_naissance → place_of_birth (trimmed)
   */
  _normalizeAttributes(data) {
    if (!data || typeof data !== 'object') return {};

    // Build a case-insensitive lookup so we catch any casing variant
    const lc = {};
    for (const [k, v] of Object.entries(data)) {
      if (v != null && v !== '') lc[k.toLowerCase()] = v;
    }

    const pick = (...keys) => {
      for (const k of keys) {
        const v = lc[k.toLowerCase()];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    };

    const attrs = {};

    // --- Name fields ---
    const givenNames = pick(
      'givennames', 'givenNames', 'prenom', 'prénom', 'prénoms',
      'first_name', 'firstName', 'prenoms',
    ).toUpperCase();
    const surnames = pick(
      'surnames', 'surNames', 'nom', 'last_name', 'lastName',
      'family_name', 'familyName', 'noms',
    ).toUpperCase();

    if (givenNames) attrs.first_name = givenNames;
    if (surnames) attrs.last_name = surnames;

    // full_name: use explicit field or derive from first + last
    const explicit = pick(
      'full_name', 'fullName', 'nom_complet', 'nomComplet', 'name',
      'displayName', 'display_name',
    ).toUpperCase();
    if (explicit) {
      attrs.full_name = explicit;
    } else if (givenNames && surnames) {
      attrs.full_name = `${givenNames} ${surnames}`;
    } else if (givenNames || surnames) {
      attrs.full_name = givenNames || surnames;
    }

    // --- Date of birth → ISO YYYY-MM-DD ---
    const rawDob = pick(
      'dateOfBirth', 'date_of_birth', 'date_naissance', 'dateNaissance',
      'dob', 'birthDate', 'birth_date', 'birthday',
    );
    if (rawDob) {
      attrs.date_of_birth = this._normalizeDate(rawDob);
    }

    // --- Sex ---
    const rawSex = pick('sex', 'sexe', 'gender', 'genre').toUpperCase();
    if (rawSex) {
      attrs.sex = rawSex === 'MASCULIN' || rawSex === 'MALE' ? 'M'
        : rawSex === 'FEMININ' || rawSex === 'FEMALE' || rawSex === 'FÉMININ' ? 'F'
          : rawSex;
    }

    // --- Nationality ---
    const rawNat = pick(
      'nationality', 'nationalite', 'nationalité', 'citizenShip', 'citizenship',
    ).toUpperCase();
    if (rawNat) {
      attrs.nationality = rawNat;
    }

    // --- Place of birth ---
    const rawPob = pick(
      'placeOfBirth', 'place_of_birth', 'lieu_naissance', 'lieuNaissance',
      'birthPlace', 'birth_place',
    );
    if (rawPob) {
      attrs.place_of_birth = rawPob.toUpperCase();
    }

    return attrs;
  }

  /**
   * Attempt to coerce a date string into ISO YYYY-MM-DD.
   * Handles: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, YYYYMMDD, ISO 8601 datetime.
   */
  _normalizeDate(raw) {
    const s = raw.trim();

    // Already ISO date
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // ISO datetime (T or space separator) — extract date part
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);

    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = s.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

    // YYYYMMDD
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

    // Fallback: return as-is
    return s;
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
