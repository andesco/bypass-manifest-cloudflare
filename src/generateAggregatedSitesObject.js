import { generateAggregatedObjectFromSources } from './aggregation.js';

export function generateAggregatedSitesObject(...sources) {
  console.log('Starting aggregated sites object generation...');
  return generateAggregatedObjectFromSources(sources);
}
