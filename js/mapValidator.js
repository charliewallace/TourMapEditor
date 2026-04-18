/**
 * mapValidator.js — Audits a TourMap for data integrity issues.
 * Detects broken links, missing assets, and unsupported command codes.
 */

export class MapValidator {
  /**
   * Performs a comprehensive validation of the TourMap.
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Map<string, string>} availableImages — filename -> objectURL map from ImageBrowser
   * @returns {Array<{type: 'error'|'warning', category: string, message: string, lineIndex: number, id?: number}>}
   */
  static validate(tourMap, availableImages) {
    const issues = [];
    const linkEntries = tourMap.getLinkEntries();
    const validIds = new Set(linkEntries.map(e => e.id));

    tourMap.entries.forEach((entry, index) => {
      if (entry.type !== 'link') return;

      // 1. Check for Unsupported Tokens
      if (entry.unsupportedTokens && entry.unsupportedTokens.length > 0) {
        const actualUnsupported = entry.unsupportedTokens.filter(t => t !== '*loose' && t !== '+loose');
        if (actualUnsupported.length > 0) {
          issues.push({
            type: 'warning',
            category: 'Command',
            message: `Unsupported tokens: ${actualUnsupported.join(', ')}`,
            lineIndex: index,
            id: entry.id
          });
        }
      }

      // 2. Check for Broken Navigation Links
      for (const cmd in entry.links) {
        const targetId = entry.links[cmd];
        if (!validIds.has(targetId)) {
          issues.push({
            type: 'error',
            category: 'Link',
            message: `Broken link '${cmd}': target ID #${targetId} not found`,
            lineIndex: index,
            id: entry.id
          });
        }
      }

      // 3. Check for User-defined Broken Links
      if (entry.userDefined && !validIds.has(entry.userDefined.targetId)) {
        issues.push({
          type: 'error',
          category: 'Link',
          message: `Broken User-Link: target ID #${entry.userDefined.targetId} not found`,
          lineIndex: index,
          id: entry.id
        });
      }

      // 4. Check for Missing Image Files
      if (availableImages && availableImages.size > 0) {
        const expectedFilename = tourMap.getImageFilename(entry);
        if (!this._isImageAvailable(expectedFilename, availableImages)) {
          issues.push({
            type: 'warning',
            category: 'Asset',
            message: `Missing image file: '${expectedFilename}'`,
            lineIndex: index,
            id: entry.id
          });
        }
      }

      // 5. Sequence Sync Consistency Check
      const groups = tourMap.getSyncGroupsForNode(entry.id);
      
      for (const group of groups) {
        if (group.type === 'sequence' && !group.isLoose) {
          // np/ej: 'b' is included but the loop has an exception for the valid
          // entry-point pattern (one member's b points to a sibling in the group).
          // qw (shift): only 'b' is checked — it must be shared across the whole shift cluster.
          let directionalCmds;
          if (group.subtype === 'qw') {
            directionalCmds = ['b'];
          } else {
            directionalCmds = ['l', 'r', 'u', 'd', 'a', 'b'];
          }
          
          let hasConflict = false;
          let hasOmission = false;
          
          // We just compare ourselves with siblings. Since we iterate over all entries,
          // every item is checked against its siblings at least once.
          for (const sibId of group.siblings) {
            const sib = tourMap.findById(sibId);
            if (!sib) continue;
            
            for (const cmd of directionalCmds) {
               const myLink = entry.links[cmd];
               const sibLink = sib.links[cmd];
               
               // 'b' (back) exception: the entry-point member of the set may have a
               // different b link (e.g. pointing back to a pre-zoom view it was arrived
               // from), while all other members correctly point b to that entry member.
               // Valid patterns:
               //   myLink === sib.id  → I point back to sibling (sibling is entry point)
               //   sibLink === entry.id → sibling points back to me (I am entry point)
               //   one side has no b at all (original escape-chain case)
               if (cmd === 'b') {
                  if (myLink === sib.id || sibLink === entry.id) {
                     continue; // Valid: entry-point pattern
                  }
                  if ((myLink === sib.id && !sibLink) || (sibLink === entry.id && !myLink)) {
                     continue; // Valid: one-sided escape
                  }
               }
  
               if (myLink && sibLink && myLink !== sibLink) {
                  hasConflict = true;
               } else if ((myLink && !sibLink) || (!myLink && sibLink)) {
                  hasOmission = true;
               }
            }
            if (hasConflict) break;
          }
  
          if (hasConflict || hasOmission) {
            const category = hasConflict ? 'Sync Conflict' : 'Sync Omission';
            const shortDesc = hasConflict ? 'Conflicting sequence link targets across views.' : 'Missing expected sequence link across views.';
            const message = `${shortDesc}<br><span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); display: inline-block; margin-top: 4px;">[${index + 3}] ${entry.raw.substring(0, 60)}${entry.raw.length > 60 ? '...' : ''}</span>`;
            
            // Add a custom property so the UI can detect this and offer actions
            issues.push({
              type: 'warning',
              category: category,
              message: message,
              lineIndex: index,
              id: entry.id,
              actionData: { type: 'sequence_mismatch', subtype: group.subtype, groupId: group.siblings }
            });
          }
        }
      }
    });

    // Deduplicate Sync issues so we don't spam one per node in the sequence
    const dedupedIssues = [];
    const seenSequences = new Set();
    
    for (const is of issues) {
       if (is.category === 'Sync') {
         // Create a stable key from sorted siblings + subtype
         const allMembers = [is.id, ...is.actionData.groupId].map(i => String(i)).sort().join('_');
         const key = `${is.actionData.subtype}_${allMembers}`;
         if (seenSequences.has(key)) continue;
         seenSequences.add(key);
       }
       dedupedIssues.push(is);
    }
    
    return dedupedIssues;
  }

  /**
   * Helper to check image availability case-insensitively and via basename fallback.
   */
  static _isImageAvailable(filename, availableImages) {
    if (!filename) return false;
    
    // Exact or Case-insensitive match via direct lookup would require the ImageMapLower logic,
    // but we'll keep it simple by iterating if needed or assuming lowerKey match.
    const lowerFilename = filename.toLowerCase();
    
    // Check keys directly (assuming key might be full relative path)
    for (const key of availableImages.keys()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === lowerFilename) return true;
      // Basename fallback: if "DCP_1234.jpg" matches "images/DCP_1234.jpg"
      if (lowerKey.split('/').pop() === lowerFilename.split('/').pop()) return true;
    }

    return false;
  }
}
