import { jwtDecode } from 'jwt-decode';

interface JWTPayload {
  exp?: number;
  iat?: number;
  [key: string]: any;
}

/**
 * Checks if a JWT token is expired
 * @param token - The JWT token string to check
 * @returns true if token is expired or invalid, false if still valid
 */
export function isTokenExpired(token: string): boolean {
  try {
    if (!token || token.trim() === '') {
      return true;
    }

    const decoded = jwtDecode<JWTPayload>(token);

    // If there's no expiration time, treat as invalid
    if (!decoded.exp) {
      return true;
    }

    // exp is in seconds, Date.now() is in milliseconds
    const currentTime = Date.now() / 1000;

    // Add a small buffer (5 seconds) to account for clock skew
    return decoded.exp < (currentTime + 5);
  } catch (error) {
    // If token is malformed or can't be decoded, treat as expired
    console.error('Error decoding token:', error);
    return true;
  }
}
