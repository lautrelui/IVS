/**
 * Identifier normalization rules per type.
 * Each normalizer returns { normalized, valid, error? }
 */

const normalizers = {
  NIU: (rawValue, _issuerCountry) => {
    let value = rawValue.trim();
    // Remove spaces and non-semantic dashes
    value = value.replace(/[\s-]/g, '');
    // Uppercase for consistent matching
    value = value.toUpperCase();
    // NIU is alphanumeric (e.g. P24000000544639E)
    if (!/^[A-Z0-9]+$/.test(value)) {
      return { normalized: null, valid: false, error: 'NIU must be alphanumeric' };
    }
    if (value.length < 8 || value.length > 25) {
      return { normalized: null, valid: false, error: `NIU length ${value.length} outside valid range (8-25)` };
    }
    return { normalized: value, valid: true };
  },

  PASSPORT: (rawValue, _issuerCountry) => {
    let value = rawValue.trim();
    // Uppercase, remove spaces
    value = value.toUpperCase().replace(/\s/g, '');
    // Validate alphanumeric
    if (!/^[A-Z0-9]+$/.test(value)) {
      return { normalized: null, valid: false, error: 'Passport must be alphanumeric' };
    }
    if (value.length < 5 || value.length > 20) {
      return { normalized: null, valid: false, error: `Passport length ${value.length} outside valid range (5-20)` };
    }
    return { normalized: value, valid: true };
  },

  NID: (rawValue, _issuerCountry) => {
    let value = rawValue.trim();
    value = value.toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9-]+$/.test(value)) {
      return { normalized: null, valid: false, error: 'NID must be alphanumeric (with optional dashes)' };
    }
    if (value.length < 5 || value.length > 30) {
      return { normalized: null, valid: false, error: `NID length ${value.length} outside valid range (5-30)` };
    }
    return { normalized: value, valid: true };
  },

  DRIVER_LICENSE: (rawValue, _issuerCountry) => {
    let value = rawValue.trim();
    value = value.toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9-]+$/.test(value)) {
      return { normalized: null, valid: false, error: 'Driver license must be alphanumeric (with optional dashes)' };
    }
    if (value.length < 5 || value.length > 30) {
      return { normalized: null, valid: false, error: `Driver license length ${value.length} outside valid range (5-30)` };
    }
    return { normalized: value, valid: true };
  },
};

const SUPPORTED_TYPES = Object.keys(normalizers);

function normalize(identifierType, rawValue, issuerCountry) {
  const normalizer = normalizers[identifierType];
  if (!normalizer) {
    return {
      normalized: null,
      valid: false,
      error: `Unsupported identifier type: ${identifierType}. Supported: ${SUPPORTED_TYPES.join(', ')}`,
    };
  }
  return normalizer(rawValue, issuerCountry);
}

module.exports = { normalize, SUPPORTED_TYPES };
