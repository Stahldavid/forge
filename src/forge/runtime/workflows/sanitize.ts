const SECRET_PATTERNS = [
  /sk_[a-zA-Z0-9]+/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /password\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
];

const MAX_ERROR_LENGTH = 500;

export function sanitizeWorkflowError(message: string): string {
  let sanitized = message;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[redacted]");
  }
  if (sanitized.length > MAX_ERROR_LENGTH) {
    return `${sanitized.slice(0, MAX_ERROR_LENGTH)}…`;
  }
  return sanitized;
}
