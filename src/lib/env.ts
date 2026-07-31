/**
 * Reads the three required secrets. Throws a readable error instead of
 * letting an undefined URL turn into a fetch to "undefined/collections".
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env locally, or run: netlify env:set ${name} <value>`
    );
  }
  return value;
}

/** Optional vars degrade gracefully instead of throwing. */
export function optional(name: string): string | null {
  return process.env[name]?.trim() || null;
}

export function getEnv() {
  const rawQdrant = required('QDRANT_URL');
  // Qdrant Cloud shows the endpoint without a port; the REST API lives on 6333.
  const url = new URL(rawQdrant);
  if (!url.port) url.port = '6333';

  return {
    GEMINI_API_KEY: required('GEMINI_API_KEY'),
    QDRANT_API_KEY: required('QDRANT_API_KEY'),
    QDRANT_URL: url.origin,
  };
}
