import { generateAggregatedArrayFromSources } from './aggregation.js';

export function generateAggregatedJson(...sources) {
  console.log('Starting aggregation...');
  return JSON.stringify(generateAggregatedArrayFromSources(sources), null, 2);
}
