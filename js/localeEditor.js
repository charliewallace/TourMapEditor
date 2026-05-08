/**
 * localeEditor.js — Center panel alternative: renders the compass rose
 * showing 8 heading slots for a locale, handling drag-and-drop to
 * assign headings to views.
 */

import { HEADINGS_8 } from './dataModel.js';
import { computeAutoLinks } from './autoLinker.js';

export class LocaleEditor {
  /**
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Function} onNavigateToPhoto - callback(photoId) when user clicks a thumb
   * @param {Function} onHeadingAssigned - callback(photoId, heading)
   * @param {Function} getImageUrl - callback(photoId) => URL | null
   * @param {Function} onConnectLocales - callback(sourceId, heading, targetLocaleId)
   */
  constructor(tourMap, onNavigateToPhoto, onHeadingAssigned, getImageUrl, onConnectLocales) {
    this.tourMap = tourMap;
    this.onNavigate = onNavigateToPhoto;
    this.onHeadingAssigned = onHeadingAssigned;
    this.getImageUrl = getImageUrl;
    this.onConnectLocales = onConnectLocales;
    this.currentLocaleGroup = null;
    this.isVirtual = false;
    this.pileIndex = 0;
    
    // Virtual locale specific callbacks (assigned from outside)
    this.onVirtualFormalize = null;
    this.onVirtualDiscard = null;
    this.onVirtualUndo = null;

    this._setupSlots();
    this._setupVirtualBanner();
    // Auto-links are now computed automatically on mutations via app.js
  }

  _setupSlots() {
    const slots = document.querySelectorAll('#locale-compass .compass-slot');
    slots.forEach(slot => {
      const heading = slot.dataset.heading;

      // Drop target for images
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        slot.classList.add('drop-target');
      });
      slot.addEventListener('dragleave', () => {
        slot.classList.remove('drop-target');
      });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drop-target');
        const photoId = e.dataTransfer.getData('application/photo-id');
        const imageName = e.dataTransfer.getData('application/image-name');
        
        if (photoId) {
          const imagesContainer = slot.querySelector('.slot-images');
          const existingCount = imagesContainer.querySelectorAll('.slot-thumb-wrapper').length;
          
          if (existingCount > 0) {
            this._showDesignationPrompt(slot, photoId, imageName);
          } else {
            this.onHeadingAssigned(photoId, heading, imageName);
          }
        }
      });
    });
  }

  _setupVirtualBanner() {
    document.getElementById('btn-vl-formalize')?.addEventListener('click', () => {
      const desc = document.getElementById('vl-description-input')?.value.trim();
      if (this.onVirtualFormalize) this.onVirtualFormalize(desc);
    });
    document.getElementById('btn-vl-discard')?.addEventListener('click', () => {
      if (this.onVirtualDiscard) this.onVirtualDiscard();
    });
    document.getElementById('btn-vl-undo')?.addEventListener('click', () => {
      if (this.onVirtualUndo) this.onVirtualUndo();
    });
  }

  /**
   * @param {{ localeId: number, description: string, entries: import('./dataModel.js').MapEntry[] }|null} localeGroup
   * @param {number|null} selectedId
   * @param {boolean} isVirtual
   */
  update(localeGroup, selectedId = undefined, isVirtual = false) {
    if (selectedId !== undefined) {
      this.selectedId = selectedId;
    }
    
    // Reset pile index if switching locales
    if (!this.currentLocaleGroup || !localeGroup || this.currentLocaleGroup.localeId !== localeGroup.localeId) {
      this.pileIndex = 0;
    }
    
    this.currentLocaleGroup = localeGroup;
    this.isVirtual = isVirtual;
    const activeId = this.selectedId || null;
    
    // Title & Subtitle updates
    const titleEl = document.getElementById('locale-editor-title');
    const nameEl = document.getElementById('locale-center-name');
    const idEl = document.getElementById('locale-center-id');

    if (!localeGroup) {
      titleEl.textContent = 'Locale Editor';
      nameEl.textContent = 'No Locale';
      idEl.textContent = '';
      // Clear all compass slots
      document.querySelectorAll('#locale-compass .compass-slot').forEach(slot => {
        const imagesContainer = slot.querySelector('.slot-images');
        if (imagesContainer) imagesContainer.innerHTML = '';
        slot.classList.remove('has-images');
      });
      // Hide unassigned stack
      const stackArea = document.getElementById('unassigned-stack-area');
      if (stackArea) { stackArea.innerHTML = ''; stackArea.classList.add('hidden'); }
      return;
    }

    titleEl.textContent = isVirtual ? `Formalize Virtual Locale — VL-${Math.abs(localeGroup.localeId)}` : `Locale Editor — #${localeGroup.localeId}`;
    nameEl.textContent = localeGroup.description || '(No description)';
    idEl.textContent = isVirtual ? `VL-${Math.abs(localeGroup.localeId)}` : `#${localeGroup.localeId}`;

    const container = document.getElementById('locale-editor-container');
    const subtitle = document.getElementById('locale-editor-subtitle');
    const banner = document.getElementById('virtual-locale-banner');
    
    if (isVirtual) {
      container.classList.add('virtual-locale-mode');
      subtitle.classList.add('hidden');
      banner.classList.remove('hidden');
    } else {
      container.classList.remove('virtual-locale-mode');
      subtitle.classList.remove('hidden');
      banner.classList.add('hidden');
    }

    // Map the 16 compass headings to our 8 slots for display
    const mappedEntries = { N:[], NW:[], W:[], SW:[], S:[], SE:[], E:[], NE:[] };

    localeGroup.entries.forEach(entry => {
      let h = 'none'; // Default to 'none' if no heading or not a link
      if (entry.type === 'link') {
        const rawHeading = this.isVirtual ? (entry.inferredHeading || entry.heading) : entry.heading;
        if (rawHeading) {
          // Find nearest 8-point equivalent
          h = rawHeading.toUpperCase();
          if (h === 'NNE' || h === 'NNW') h = 'N';
          else if (h === 'ENE' || h === 'ESE') h = 'E';
          else if (h === 'SSE' || h === 'SSW') h = 'S';
          else if (h === 'WSW' || h === 'WNW') h = 'W';
        }
      }
      
      if (!mappedEntries[h]) mappedEntries[h] = []; // Ensure it's initialized
      mappedEntries[h].push(entry);
    });

    // Special handling for unassigned (no heading) photos
    // Render them in a dedicated stack area below the compass center
    let stackArea = document.getElementById('unassigned-stack-area');
    if (!stackArea) {
      // Create the stack area container below the compass grid
      const compassEl = document.getElementById('locale-compass');
      stackArea = document.createElement('div');
      stackArea.id = 'unassigned-stack-area';
      stackArea.className = 'unassigned-stack-area';
      compassEl.parentElement.insertBefore(stackArea, compassEl.nextSibling);
    }
    stackArea.innerHTML = '';
    
    const unmapped = mappedEntries['none'] || [];
    if (unmapped.length > 0) {
      stackArea.classList.remove('hidden');
      
      const hint = document.createElement('div');
      hint.className = 'unassigned-hint';
      hint.textContent = 'Please drag to compass heading';
      stackArea.appendChild(hint);
      
      const pileContainer = document.createElement('div');
      pileContainer.style.display = 'flex';
      pileContainer.style.alignItems = 'center';
      pileContainer.style.gap = '20px';

      // Left Arrow
      const btnPrev = document.createElement('button');
      btnPrev.className = 'unassigned-nav-btn';
      btnPrev.innerHTML = '◀';
      btnPrev.disabled = this.pileIndex === 0;
      btnPrev.addEventListener('click', () => {
        if (this.pileIndex > 0) {
          this.pileIndex--;
          this.update(this.currentLocaleGroup, this.selectedId, this.isVirtual);
        }
      });
      pileContainer.appendChild(btnPrev);
      
      // The Pile
      const pile = document.createElement('div');
      pile.className = 'unassigned-pile';
      pile.style.position = 'relative';
      pile.style.width = '160px'; // fixed width to hold absolute children
      pile.style.height = '120px';
      
      // Render the current item and up to 3 underneath it for visual depth
      const maxDepth = Math.min(3, unmapped.length - this.pileIndex);
      for (let d = maxDepth - 1; d >= 0; d--) {
        const itemIndex = this.pileIndex + d;
        const entry = unmapped[itemIndex];
        const wrapper = this._createThumbWrapper(entry, activeId, 'none');
        
        wrapper.style.position = 'absolute';
        wrapper.style.top = '0';
        wrapper.style.left = '10px';
        
        // Stagger
        const scale = 1 - (d * 0.05);
        const yOffset = d * 8;
        wrapper.style.transform = `scale(${scale}) translateY(${yOffset}px)`;
        wrapper.style.zIndex = maxDepth - d; // Top item has highest z-index
        wrapper.style.opacity = d === maxDepth - 1 && d > 0 ? '0.5' : '1';
        
        if (d > 0) {
          // Prevent dragging lower items
          wrapper.removeAttribute('draggable');
          wrapper.style.pointerEvents = 'none';
        }
        
        pile.appendChild(wrapper);
      }
      pileContainer.appendChild(pile);
      
      // Right Arrow
      const btnNext = document.createElement('button');
      btnNext.className = 'unassigned-nav-btn';
      btnNext.innerHTML = '▶';
      btnNext.disabled = this.pileIndex >= unmapped.length - 1;
      btnNext.addEventListener('click', () => {
        if (this.pileIndex < unmapped.length - 1) {
          this.pileIndex++;
          this.update(this.currentLocaleGroup, this.selectedId, this.isVirtual);
        }
      });
      pileContainer.appendChild(btnNext);
      
      stackArea.appendChild(pileContainer);
      
      // Counter
      const counter = document.createElement('div');
      counter.className = 'unassigned-nav-counter';
      counter.textContent = `${this.pileIndex + 1} of ${unmapped.length}`;
      stackArea.appendChild(counter);

    } else {
      stackArea.classList.add('hidden');
    }

    // Heading slots
    const slots = document.querySelectorAll('#locale-compass .compass-slot');
    slots.forEach(slot => {
      const heading = slot.dataset.heading;
      const imagesContainer = slot.querySelector('.slot-images');
      imagesContainer.innerHTML = '';
      
      const entries = mappedEntries[heading];
      if (entries && entries.length > 0) {
        slot.classList.add('has-images');
        
        // Sort topologically based on exact u/d links
        entries.sort((a, b) => {
           if (a.links['u'] == b.id || b.links['d'] == a.id) return 1; // a is below b
           if (a.links['d'] == b.id || b.links['u'] == a.id) return -1; // a is above b
           return 0;
        });

        // Determine Level image based on incoming/outgoing links across the tour
        let levelIdx = 0;
        let bestScore = -1;
        
        entries.forEach((e, idx) => {
            let score = 0;
            // 1. Incoming 'f' or 'b' is the strongest indicator of a base level image
            const incomingFB = this.tourMap.entries.some(other => other.links['f'] == e.id || other.links['b'] == e.id);
            if (incomingFB) score += 100;
            
            // 2. Incoming 'l' or 'r' (part of the horizontal ring)
            const incomingLR = this.tourMap.entries.some(other => other.links['l'] == e.id || other.links['r'] == e.id);
            if (incomingLR) score += 50;
            
            // 3. Outgoing horizontal links
            if (e.links['l'] || e.links['r']) score += 10;
            
            // 4. Outgoing forward/back links
            if (e.links['f'] || e.links['b']) score += 5;

            // 5. If it's the middle of a 3-image stack (has both u and d to other members)
            const hasU = entries.some(other => other.id == e.links['u']);
            const hasD = entries.some(other => other.id == e.links['d']);
            if (hasU && hasD) score += 200; // Middle of a 3-stack is definitely the level image
            
            if (score > bestScore) {
                bestScore = score;
                levelIdx = idx;
            }
        });

        entries.forEach((entry, idx) => {
          const isUp = idx < levelIdx;
          const isDown = idx > levelIdx;
          const wrapper = this._createThumbWrapper(entry, activeId, heading, isUp, isDown);
          imagesContainer.appendChild(wrapper);
        });

        // If exactly 2 images, add a "Link as Door" helper button
        if (entries.length === 2) {
          const [e1, e2] = entries;
          const isDoorLinked = e1.links['o'] || e1.links['c'] || e2.links['o'] || e2.links['c'];
          const isVertLinked = e1.links['u'] == e2.id || e1.links['d'] == e2.id || e2.links['u'] == e1.id || e2.links['d'] == e1.id;
          if (!isDoorLinked && !isVertLinked) {
            const linkBtn = document.createElement('button');
            linkBtn.className = 'link-door-helper';
            linkBtn.innerHTML = '🔗 Link as Door';
            linkBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (this.onLinkAsDoor) this.onLinkAsDoor(e1.id, e2.id);
            });
            imagesContainer.appendChild(linkBtn);
          }
        }
      } else {
        slot.classList.remove('has-images');
      }

      // Manage Locale Link Input
      const linkInput = slot.querySelector('.locale-link-input');
      const clearBtn = slot.querySelector('.locale-link-clear');
      
      if (linkInput) {
        if (entries && entries.length > 0) {
          const e1 = entries[0];
          linkInput.disabled = false;
          let targetLocale = null;
          if (e1.links['f']) {
             const target = this.tourMap.findById(e1.links['f']);
             if (target && target.localeId !== null && target.localeId !== localeGroup.localeId) {
               targetLocale = target.localeId;
             }
          }
          linkInput.value = targetLocale !== null ? targetLocale : '';
          
          if (clearBtn) {
            if (targetLocale !== null) {
              clearBtn.classList.remove('hidden');
            } else {
              clearBtn.classList.add('hidden');
            }
          }
          
          // Clone and replace to clear old listeners securely
          const newLinkInput = linkInput.cloneNode(true);
          linkInput.parentNode.replaceChild(newLinkInput, linkInput);
          
          const newClearBtn = clearBtn ? clearBtn.cloneNode(true) : null;
          if (clearBtn && newClearBtn) clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
          
          newLinkInput.addEventListener('change', (e) => {
             const val = e.target.value.trim();
             const newLocId = val ? parseInt(val, 10) : null;
             if (this.onConnectLocales) {
                this.onConnectLocales(e1.id, heading, newLocId);
             }
          });

          if (newClearBtn) {
            newClearBtn.addEventListener('click', (e) => {
               e.stopPropagation();
               newLinkInput.value = '';
               if (this.onConnectLocales) {
                 this.onConnectLocales(e1.id, heading, null);
               }
            });
          }
        } else {
          linkInput.disabled = true;
          linkInput.value = '';
          if (clearBtn) clearBtn.classList.add('hidden');
        }
      }
    });
  }

  _createThumbWrapper(entry, activeId, heading, isUp = false, isDown = false) {
    const url = this.getImageUrl(entry.id);
    
    const wrapper = document.createElement('div');
    wrapper.className = 'slot-thumb-wrapper';
    if (activeId !== null && entry.id === activeId) {
      wrapper.classList.add('selected');
    }

    const thumb = document.createElement('img');
    thumb.className = 'slot-thumb';
    thumb.title = `Photo #${entry.id}`;
    if (url) {
      thumb.src = url;
      thumb.alt = `Photo ${entry.id}`;
    } else {
      thumb.alt = entry.id;
    }
    
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onNavigate(entry.id);
    });
    
    wrapper.appendChild(thumb);

    wrapper.setAttribute('draggable', 'true');
    wrapper.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/photo-id', entry.id);
      e.dataTransfer.effectAllowed = 'link';
      wrapper.classList.add('dragging');
    });
    wrapper.addEventListener('dragend', () => wrapper.classList.remove('dragging'));

    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      wrapper.classList.add('drop-target');
    });
    wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drop-target'));
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.remove('drop-target');
      const sourceId = e.dataTransfer.getData('application/photo-id');
      const imageName = e.dataTransfer.getData('application/image-name');
      if (sourceId && sourceId !== entry.id) {
        const slot = wrapper.closest('.compass-slot') || wrapper.closest('.compass-center');
        this._showDesignationPrompt(slot, sourceId, imageName);
      }
    });

    if (entry.links['o']) {
      const badge = document.createElement('span');
      badge.className = 'slot-badge closed-badge';
      badge.textContent = 'C';
      wrapper.appendChild(badge);
    } else if (entry.links['c']) {
      const badge = document.createElement('span');
      badge.className = 'slot-badge open-badge';
      badge.textContent = 'O';
      wrapper.appendChild(badge);
    } else if (isDown) {
      const badge = document.createElement('span');
      badge.className = 'slot-badge down-badge';
      badge.textContent = 'D';
      wrapper.appendChild(badge);
    } else if (isUp) {
      const badge = document.createElement('span');
      badge.className = 'slot-badge up-badge';
      badge.textContent = 'U';
      wrapper.appendChild(badge);
    }

    return wrapper;
  }

  _setupSlotListeners(slot) {
    const heading = slot.dataset.heading;
    
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      slot.classList.add('drop-target');
    });
    
    slot.addEventListener('dragleave', () => {
      slot.classList.remove('drop-target');
    });

    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drop-target');
      const photoId = e.dataTransfer.getData('application/photo-id');
      const imageName = e.dataTransfer.getData('application/image-name');
      
      if (photoId) {
        const imagesContainer = slot.querySelector('.slot-images');
        const existingCount = imagesContainer.querySelectorAll('.slot-thumb-wrapper').length;
        
        if (existingCount > 0) {
          this._showDesignationPrompt(slot, photoId, imageName);
        } else {
          this.onHeadingAssigned(photoId, heading, imageName);
        }
      }
    });
  }

  _showDesignationPrompt(slot, photoId, imageName) {
    const heading = slot.dataset.heading;
    const imagesContainer = slot.querySelector('.slot-images');
    const existingThumbs = imagesContainer.querySelectorAll('.slot-thumb-wrapper');
    // Get the ID of the first existing photo in this slot to link with
    let targetId = null;
    if (existingThumbs.length > 0) {
       // We need to find the entry matching one of these thumbs.
       // For now, let's just pick the first one which is likely the one already there.
       const firstThumb = existingThumbs[0].querySelector('.slot-thumb');
       targetId = firstThumb.title.replace('Photo #', '');
    }

    const overlay = document.createElement('div');
    overlay.className = 'designation-overlay';
    overlay.innerHTML = `
      <div class="designation-dialog">
        <h4>Designate Role for #${photoId}</h4>
        <div class="designation-buttons">
          <button class="designation-btn open" data-role="open">Set as Open Variant</button>
          <button class="designation-btn closed" data-role="closed">Set as Closed Variant</button>
          <button class="designation-btn neutral" data-role="none">Add as Normal View</button>
        </div>
      </div>
    `;

    overlay.querySelectorAll('.designation-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.role;
        this.onHeadingAssigned(photoId, heading, imageName);
        
        if (role === 'open' && targetId) {
           // This NEW one is Open, so targetId is Closed.
           // linkAsDoor(idA, idB) where idA is current.
           // If I drag B to A and say B is Open, then A is Closed, B is Open.
           this.onLinkAsDoor(targetId, photoId);
        } else if (role === 'closed' && targetId) {
           // This NEW one is Closed, so targetId is Open.
           // linkAsDoor(idA, idB, currentIsB=true) -> A is open, B is closed.
           // Wait, linkAsDoor(idA, idB, null, true) in app.js does exactly this.
           this.onLinkAsDoor(targetId, photoId, true);
        }
        overlay.remove();
      });
    });

    slot.appendChild(overlay);
    setTimeout(() => {
        document.addEventListener('click', (e) => {
            if (!overlay.contains(e.target)) overlay.remove();
        }, { once: true });
    }, 10);
  }
}
