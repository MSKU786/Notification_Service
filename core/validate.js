/**
 * Validate and normalize an incoming notification request.
 *
 * Request shape:
 *   {
 *     type:    string   (required) — channel name, e.g. "email" | "sms" | "slack"
 *     message: string   (required) — the body to deliver
 *     to:      string   (optional) — recipient address/handle/number
 *     meta:    object   (optional) — channel-specific extras (subject, etc.)
 *   }
 *
 * Returns { errors: string[], value: normalized }
 */
function validateNotification(body) {
  const errors = [];
  const value = {};

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be a JSON object'], value };
  }

  const { type, message, to, meta } = body;

  if (typeof type !== 'string' || type.trim() === '') {
    errors.push('"type" is required and must be a non-empty string');
  } else {
    value.type = type.trim();
  }

  if (typeof message !== 'string' || message.trim() === '') {
    errors.push('"message" is required and must be a non-empty string');
  } else {
    value.message = message;
  }

  if (to !== undefined && typeof to !== 'string') {
    errors.push('"to" must be a string when provided');
  } else if (to !== undefined) {
    value.to = to;
  }

  if (meta !== undefined) {
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
      errors.push('"meta" must be an object when provided');
    } else {
      value.meta = meta;
    }
  }

  return { errors, value };
}

module.exports = { validateNotification };
