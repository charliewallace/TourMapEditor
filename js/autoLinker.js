/**
 * autoLinker.js — Computes automatic left, right, and turn-around links
 * for views within locales based on their compass headings.
 */

import { HEADINGS } from './dataModel.js';

// The 8 primary headings in counter-clockwise order
export const HEADINGS_8 = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];

// Opposite heading mapping for "turn around" (a) links
const OPPOSITES = {
  'N': 'S', 'S': 'N',
  'NE': 'SW', 'SW': 'NE',
  'E': 'W', 'W': 'E',
  'SE': 'NW', 'NW': 'SE'
};

// Map 16-point headings to nearest 8-point headings
const HEADING_MAP_16_TO_8 = {
  'N': 'N', 'NNE': 'N',
  'NE': 'NE', 'ENE': 'E',
  'E': 'E', 'ESE': 'E',
  'SE': 'SE', 'SSE': 'S',
  'S': 'S', 'SSW': 'S',
  'SW': 'SW', 'WSW': 'W',
  'W': 'W', 'WNW': 'W',
  'NW': 'NW', 'NNW': 'N'
};

/**
 * Computes and populates the `autoLinks` field for all link entries in the tour.
 * Existing manual links are not overwritten.
 * 
 * @param {import('./dataModel.js').TourMap} tourMap
 */
export function computeAutoLinks(tourMap) {
  // 1. Clear any previously computed auto-links
  for (const entry of tourMap.getLinkEntries()) {
    entry.autoLinks = {};
  }

  const locales = tourMap.getLocaleGroups();

  for (const locale of locales) {
    if (locale.entries.length < 2) continue;

    const headingGroups = {};
    const presentHeadings = [];

    // 2. Group views by primary 8-point heading
    for (const entry of locale.entries) {
      if (!entry.heading) continue;
      
      const primaryHeading = HEADING_MAP_16_TO_8[entry.heading];
      if (!primaryHeading) continue;

      if (!headingGroups[primaryHeading]) {
        headingGroups[primaryHeading] = [];
        presentHeadings.push(primaryHeading);
      }
      headingGroups[primaryHeading].push(entry);
    }

    // 3. Compute Left / Right links
    if (presentHeadings.length >= 2) {
      const occupiedIndices = new Set();
      presentHeadings.forEach(h => occupiedIndices.add(HEADINGS_8.indexOf(h)));

      for (const heading of presentHeadings) {
        const currentIndex = HEADINGS_8.indexOf(heading);
        const groupEntries = headingGroups[heading];

        // Find left link (next CCW, max gap = 2 empty slots -> check distance 1 to 3)
        let leftIndex = -1;
        for (let i = 1; i <= 3; i++) {
          const checkIndex = (currentIndex + i) % 8;
          if (occupiedIndices.has(checkIndex)) {
            leftIndex = checkIndex;
            break;
          }
        }

        // Find right link (previous CCW, max gap = 2)
        let rightIndex = -1;
        for (let i = 1; i <= 3; i++) {
          const checkIndex = (currentIndex - i + 8) % 8;
          if (occupiedIndices.has(checkIndex)) {
            rightIndex = checkIndex;
            break;
          }
        }

        // Apply auto L/R links to all views in this heading group
        for (const entry of groupEntries) {
          if (leftIndex !== -1 && !entry.links['l']) {
            const targetHeading = HEADINGS_8[leftIndex];
            // Link to the *first* view assigned to that heading group
            entry.autoLinks['l'] = headingGroups[targetHeading][0].id;
          }
          if (rightIndex !== -1 && !entry.links['r']) {
            const targetHeading = HEADINGS_8[rightIndex];
            entry.autoLinks['r'] = headingGroups[targetHeading][0].id;
          }
        }
      }
    }

    // 4. Compute Turn Around ('a') links
    for (const heading of presentHeadings) {
      const oppHeading = OPPOSITES[heading];
      if (headingGroups[oppHeading]) {
        for (const entry of headingGroups[heading]) {
          if (!entry.links['a']) {
            entry.autoLinks['a'] = headingGroups[oppHeading][0].id;
          }
        }
      }
    }
  }
}
