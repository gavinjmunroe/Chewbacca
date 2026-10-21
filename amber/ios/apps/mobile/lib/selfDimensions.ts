import { callMedhaId, type MedhaIdResult } from './medhaId';
import {
  type CoverageSummary,
  type DimensionCoverage,
} from './healthDimensions';

/**
 * HOW WELL AMBER KNOWS YOU, ACROSS THE SIX DIMENSIONS.
 *
 * WHAT THIS IS NOT, and the wording of everything below depends on it: it is not
 * a wellbeing score. The evidence underneath is what somebody happened to
 * mention to an app, so a low spiritual number means Amber has heard nothing
 * about that part of their life, not that the part is thin. Rendering it as a
 * verdict would be inventing an assessment out of note-taking, and the person it
 * judged would have no way to know the judgment was made of silence.
 *
 * So every string in this file says KNOWN, and none of them say GOOD. An empty
 * dimension is phrased as something Amber has not heard about yet, which is both
 * true and the only version that suggests a useful next step.
 *
 * WHERE THE NUMBERS COME FROM. amber_id's GET /v1/me/dimensions, which scores
 * two things and weights them very differently: self-facts you have stated
 * (full weight) and the dimensions of the questions you have asked (a fifth of
 * it). Both decay at the half-life the ontology already declares per dimension.
 */

export function getSelfDimensions(): Promise<
  MedhaIdResult<{ dimensions: DimensionCoverage[]; summary: CoverageSummary; knownAt: number }>
> {
  return callMedhaId({ path: '/v1/me/dimensions', method: 'GET', requireAuth: true });
}


/**
 * THE PURE HALF LIVES IN lib/healthDimensions.ts, and re-exports here so callers
 * have one import.
 *
 * The split is not tidiness. This file imports the authed transport, which
 * imports the whole medha-id client, and Node's type-stripping resolves neither
 * -- so anything in here is code no test can reach. The mapping from the
 * server's dimension order onto the radar's spokes is exactly the thing that
 * must be tested, because getting it wrong plots every score on the wrong axis
 * and draws a shape that looks perfectly fine.
 */
export {
  RADAR_DIMENSIONS,
  coverageLine,
  coverageNudge,
  dimensionsToRadar,
  hasAnyCoverage,
} from './healthDimensions';
export type { CoverageSummary, DimensionCoverage } from './healthDimensions';
