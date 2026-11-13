import { AppError } from './store.mjs';

export const str = (maxLength = 255, minLength = 1) => ({ type: 'string', minLength, maxLength });
export const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
export const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const bool = { type: 'boolean' };
export const choice = (...values) => ({ type: 'string', enum: values });
export const list = (items, maxItems = 100) => ({ type: 'array', items, maxItems });
export const nullable = (schema) => ({ type: 'nullable', schema });
export const day = { type: 'day' };
export const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});

export function validate(schema, value, label = 'Input') {
  const fail = (message) => { throw new AppError(400, `${label} ${message}`); };
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('must be an object.');
      for (const key of schema.required) if (!Object.hasOwn(value, key)) fail(`requires ${key}.`);
      const result = Object.create(null);
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) fail(`contains an unknown field (${key.slice(0, 50)}).`);
        result[key] = validate(schema.properties[key], value[key], key);
      }
      return result;
    }
    case 'string': {
      if (typeof value !== 'string') fail('must be text.');
      const text = value.trim();
      if (schema.enum && !schema.enum.includes(text)) fail('has an invalid value.');
      if (text.length < (schema.minLength ?? 0) || text.length > (schema.maxLength ?? Infinity)) fail('has an invalid length.');
      if (text.includes('\0')) fail('has an invalid character.');
      return text;
    }
    case 'integer':
    case 'number':
      if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value))) fail('must be a valid number.');
      if (value < schema.minimum || value > schema.maximum) fail('is out of range.');
      return value;
    case 'nullable':
      return value === null || value === '' ? null : validate(schema.schema, value, label);
    case 'day':
      if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail('must be a date (YYYY-MM-DD).');
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') fail('must be true or false.');
      return value;
    case 'array':
      if (!Array.isArray(value) || value.length > schema.maxItems) fail('must be a list of the allowed size.');
      return value.map((item, index) => validate(schema.items, item, `${label} item ${index + 1}`));
    default:
      throw new Error('Unknown input schema.');
  }
}

export function email(value, optional = false) {
  if (!value && optional) return '';
  if (typeof value !== 'string' || value.length > 254 || !/^[\w.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value)) {
    throw new AppError(400, 'Enter a valid email address.');
  }
  return value.toLowerCase();
}

export function time(value, optional = false) {
  if (!value && optional) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new AppError(400, 'Enter a date and time with its time zone.');
  }
  return new Date(value).toISOString();
}

export function boundedInt(value, fallback, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new AppError(400, 'Invalid page or cursor.');
  return parsed;
}
