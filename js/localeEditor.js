/**
 * localeEditor.js — Center panel alternative: renders the compass rose
 * showing 8 heading slots for a locale, handling drag-and-drop to
 * assign headings to views.
 */

import { HEADINGS_8, computeAutoLinks } from './autoLinker.js';

export class LocaleEditor {
  /**
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Function} onNavigateToPhoto - callback(photoId) when user clicks a thumb
   * @param {Function} onHeadingAssigned - callback(photoId, heading)
   * @param {Function} getImageUrl - callback(photoId) => URL | null
   */
  constructor(tourMap, onNavigateToPhoto, onHeadingAssigned, getImageUrl) {
    this.tourMap = tourMap;
    this.onNavigate = onNavigateToPhoto;
    this.onHeadingAssigned = onHeadingAssigned;
    this.getImageUrl = getImageUrl;
    this.currentLocaleGroup = null;

    this._setupSlots();
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

  /**
   * @param {{ localeId: number, description: string, entries: import('./dataModel.js').MapEntry[] }|null} localeGroup
   * @param {number|null} selectedId
   */
  update(localeGroup, selectedId = undefined) {
    if (selectedId !== undefined) {
      this.selectedId = selectedId;
    }
    this.currentLocaleGroup = localeGroup;
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

    titleEl.textContent = `Locale Editor — #${localeGroup.localeId}`;
    nameEl.textContent = localeGroup.description || '(No description)';
    idEl.textContent = `#${localeGroup.localeId}`;

    // Map the 16 compass headings to our 8 slots for display
    const mappedEntries = { N:[], NW:[], W:[], SW:[], S:[], SE:[], E:[], NE:[] };

    localeGroup.entries.forEach(entry => {
      let h = 'none'; // Default to 'none' if no heading or not a link
      if (entry.type === 'link' && entry.heading) {
        // Find nearest 8-point equivalent
        h = entry.heading.toUpperCase();
        if (h === 'NNE' || h === 'NNW') h = 'N';
        else if (h === 'ENE' || h === 'ESE') h = 'E';
        else if (h === 'SSE' || h === 'SSW') h = 'S';
        else if (h === 'WSW' || h === 'WNW') h = 'W';
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
      
      const pile = document.createElement('div');
      pile.className = 'unassigned-pile';
      
      unmapped.forEach((entry, i) => {
        const wrapper = this._createThumbWrapper(entry, activeId, 'none');
        // Apply a leaning-stack offset so each photo peeks out
        const angle = (i - Math.floor(unmapped.length / 2)) * 4; // slight rotation
        const xShift = i * 12;  // horizontal stagger
        const yShift = i * 4;   // slight vertical stagger
        wrapper.style.transform = `rotate(${angle}deg) translate(${xShift}px, ${yShift}px)`;
        wrapper.style.zIndex = i + 1;
        pile.appendChild(wrapper);
      });
      
      stackArea.appendChild(pile);
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
        entries.forEach(entry => {
          const wrapper = this._createThumbWrapper(entry, activeId, heading);
          imagesContainer.appendChild(wrapper);
        });

        // If exactly 2 images, add a "Link as Door" helper button
        if (entries.length === 2) {
          const [e1, e2] = entries;
          if (!e1.links['o'] && !e1.links['c'] && !e2.links['o'] && !e2.links['c']) {
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
    });
  }

  _createThumbWrapper(entry, activeId, heading) {
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
    }
    if (entry.links['c']) {
      const badge = document.createElement('span');
      badge.className = 'slot-badge open-badge';
      badge.textContent = 'O';
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
