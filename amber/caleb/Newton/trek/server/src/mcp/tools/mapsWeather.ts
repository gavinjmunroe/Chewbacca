import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { findByIata, searchAirports } from '../../services/airportService';
import { searchPlaces, getPlaceDetails, reverseGeocode, resolveGoogleMapsUrl } from '../../services/mapsService';
import { getWeather, getDetailedWeather } from '../../services/weatherService';
import {
  TOOL_ANNOTATIONS_READONLY,
  ok,
} from './_shared';
import { canRead } from '../scopes';

export function registerMapsWeatherTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const canGeo     = canRead(scopes, 'geo');
  const canWeather = canRead(scopes, 'weather');

  // --- MAPS EXTRAS ---

  if (canGeo) server.registerTool(
    'get_place_details',
    {
      description: 'Fetch detailed information about a place by its Google Place ID.',
      inputSchema: {
        placeId: z.string().describe('Google Place ID'),
        lang: z.string().optional().default('en'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ placeId, lang }) => {
      const details = await getPlaceDetails(userId, placeId, lang ?? 'en');
      if (!details) return { content: [{ type: 'text' as const, text: 'Place not found or maps service not configured.' }], isError: true };
      return ok({ details });
    }
  );

  if (canGeo) server.registerTool(
    'reverse_geocode',
    {
      description: 'Get a human-readable address for given coordinates.',
      inputSchema: {
        lat: z.number(),
        lng: z.number(),
        lang: z.string().optional().default('en'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ lat, lng, lang }) => {
      const result = await reverseGeocode(String(lat), String(lng), lang ?? 'en');
      if (!result) return { content: [{ type: 'text' as const, text: 'Reverse geocode failed or maps service not configured.' }], isError: true };
      return ok(result);
    }
  );

  if (canGeo) server.registerTool(
    'resolve_maps_url',
    {
      description: 'Resolve a Google Maps share URL to coordinates and place name.',
      inputSchema: {
        url: z.string().describe('Google Maps share URL'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ url }) => {
      const result = await resolveGoogleMapsUrl(url);
      if (!result) return { content: [{ type: 'text' as const, text: 'Could not resolve URL or maps service not configured.' }], isError: true };
      return ok(result);
    }
  );

  // --- WEATHER ---

  if (canWeather) server.registerTool(
    'get_weather',
    {
      description: 'Get weather forecast for a location and date.',
      inputSchema: {
        lat: z.number(),
        lng: z.number(),
        date: z.string().describe('ISO date YYYY-MM-DD'),
        lang: z.string().optional().default('en'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ lat, lng, date, lang }) => {
      try {
        const weather = await getWeather(String(lat), String(lng), date, lang ?? 'en');
        return ok({ weather });
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: err?.message ?? 'Weather service not available.' }], isError: true };
      }
    }
  );

  if (canWeather) server.registerTool(
    'get_detailed_weather',
    {
      description: 'Get hourly/detailed weather forecast for a location and date.',
      inputSchema: {
        lat: z.number(),
        lng: z.number(),
        date: z.string().describe('ISO date YYYY-MM-DD'),
        lang: z.string().optional().default('en'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ lat, lng, date, lang }) => {
      try {
        const weather = await getDetailedWeather(String(lat), String(lng), date, lang ?? 'en');
        return ok({ weather });
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: err?.message ?? 'Weather service not available.' }], isError: true };
      }
    }
  );

  // --- AIRPORTS ---

  if (canGeo) server.registerTool(
    'search_airports',
    {
      description: 'Search for airports by name, city, or IATA code. Returns matching airports with IATA code, name, city, country, coordinates, and timezone. Use before create_transport (flight) to get the correct IATA code and timezone for endpoints.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Airport name, city, or IATA code (e.g. "zurich", "ZRH", "charles de gaulle")'),
        limit: z.number().int().min(1).max(50).optional().default(10),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ query, limit }) => {
      const airports = searchAirports(query, limit ?? 10);
      return ok({ airports });
    }
  );

  if (canGeo) server.registerTool(
    'get_airport',
    {
      description: 'Get a single airport by its IATA code. Returns name, city, country, coordinates, and timezone.',
      inputSchema: {
        iata: z.string().length(3).toUpperCase().describe('IATA airport code (e.g. "ZRH", "AMS", "CDG")'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ iata }) => {
      const airport = findByIata(iata);
      if (!airport) return { content: [{ type: 'text' as const, text: 'Airport not found.' }], isError: true };
      return ok({ airport });
    }
  );
}
