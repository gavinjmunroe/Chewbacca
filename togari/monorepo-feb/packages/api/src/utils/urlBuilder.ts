import { createLogger } from '@togari/core';

const logger = createLogger('URLBuilder');

/**
 * Safely construct a URL by validating the base URL and properly encoding path segments
 * Prevents SSRF attacks and URL injection
 */
export function buildSafeURL(baseUrl: string, ...pathSegments: string[]): URL {
  // Validate base URL
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    logger.error('Invalid base URL', error instanceof Error ? error : new Error(String(error)), {
      baseUrl,
    });
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }

  // Validate protocol (only allow HTTP/HTTPS)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsafe protocol: ${url.protocol}. Only HTTP and HTTPS are allowed.`);
  }

  // Validate hostname (prevent private IP ranges and localhost in production)
  if (process.env.NODE_ENV === 'production') {
    const hostname = url.hostname.toLowerCase();

    // Block localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      throw new Error(`Localhost URLs not allowed in production: ${hostname}`);
    }

    // Block private IP ranges (basic check)
    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.match(/^172\.(1[6-9]|2\d|3[01])\./)
    ) {
      throw new Error(`Private IP addresses not allowed in production: ${hostname}`);
    }
  }

  // Build path by properly encoding each segment
  const encodedSegments = pathSegments.map((segment) => {
    // Remove leading/trailing slashes from segments
    const cleaned = segment.replace(/^\/+|\/+$/g, '');
    // Encode each part
    return encodeURIComponent(cleaned);
  });

  // Join segments with slashes
  const path = encodedSegments.join('/');

  // Append to URL pathname
  if (path) {
    // Ensure base pathname ends with /
    const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    url.pathname = basePath + path;
  }

  return url;
}

/**
 * Validate that a URL is safe to use
 * Returns the validated URL or throws an error
 */
export function validateURL(urlString: string): URL {
  try {
    const url = new URL(urlString);

    // Check protocol
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Unsafe protocol: ${url.protocol}`);
    }

    return url;
  } catch (error) {
    logger.error('URL validation failed', error instanceof Error ? error : new Error(String(error)), {
      url: urlString,
    });
    throw error;
  }
}
