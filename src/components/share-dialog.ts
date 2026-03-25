/**
 * Share dialog — allows map owners to manage visibility, invite collaborators,
 * and view/remove existing shares.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ShareData } from '../services/maps.js';
import {
  getMapShares,
  generateShareLink,
  updateShare,
  deleteShare,
  updateVisibility,
} from '../services/maps.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('share-dialog')
export class ShareDialog extends LitElement {
  @property() mapId = '';
  @property() visibility: 'public' | 'private' = 'private';

  @state() private _shares: ShareData[] = [];
  @state() private _loading = false;
  @state() private _linkRole: 'viewer' | 'editor' = 'viewer';
  @state() private _generatedUrl = '';
  @state() private _generating = false;
  @state() private _pendingRemoveId: string | null = null;
  @state() private _error = '';
  @state() private _open = false;

  static styles = [waUtilities, css`
    wa-dialog::part(dialog) {
      max-width: 520px;
    }

    .link-box {
      padding: var(--wa-space-s);
      background: var(--wa-color-surface-lowered);
      border-radius: var(--wa-border-radius-m);
      font-size: var(--wa-font-size-s);
      word-break: break-all;
    }

    .label-icon {
      font-size: var(--wa-font-size-m);
      margin-right: var(--wa-space-xs);
    }

    .collab-icon-pending {
      font-size: var(--wa-font-size-l);
      color: var(--wa-color-text-quiet);
    }

    .collab-icon-claimed {
      font-size: var(--wa-font-size-l);
      color: var(--wa-color-brand-60);
    }

    .collab-row {
      padding: var(--wa-space-xs) 0;
    }

    .claim-url {
      word-break: break-all;
    }

    .role-select {
      width: 110px;
    }

    .section-label {
      font-weight: var(--wa-font-weight-bold);
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-text-normal);
      margin: 0;
    }

    .visibility-desc {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }

    .collaborator-info {
      flex: 1;
      min-width: 0;
    }

    .collaborator-name {
      font-weight: var(--wa-font-weight-semibold);
      font-size: var(--wa-font-size-s);
    }

    .collaborator-email {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }

    .pending-label {
      font-style: italic;
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-xs);
    }

    .empty-collab {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
      text-align: center;
      padding: var(--wa-space-m);
    }
  `];

  async show() {
    this._loading = true;
    this._generatedUrl = '';
    this._error = '';
    this._open = true;
    try {
      this._shares = await getMapShares(this.mapId);
    } catch {
      this._shares = [];
    } finally {
      this._loading = false;
    }
  }

  render() {
    return html`
      <wa-dialog ?open=${this._open} @wa-after-hide=${this._onClose}>
        <span slot="label"><wa-icon name="share-nodes" class="label-icon"></wa-icon> Share Trip</span>

        <div class="wa-stack wa-gap-l">
          ${this._error ? html`
            <wa-callout variant="danger">
              <wa-icon slot="icon" name="circle-info" library="fa-jelly"></wa-icon>
              ${this._error}
            </wa-callout>
          ` : nothing}

          <!-- Visibility toggle -->
          <div class="wa-stack wa-gap-xs">
            <p class="section-label">Visibility</p>
            <div class="wa-split wa-align-items-center wa-gap-m">
              <div>
                <div>${this.visibility === 'public' ? 'Public' : 'Private'}</div>
                <div class="visibility-desc">
                  ${this.visibility === 'public'
                    ? 'Anyone with the link can view this trip.'
                    : 'Only invited collaborators can access this trip.'}
                </div>
              </div>
              <wa-switch
                .checked=${this.visibility === 'public'}
                @change=${this._onVisibilityToggle}
              ></wa-switch>
            </div>
          </div>

          <wa-divider></wa-divider>

          <!-- Generate invite link -->
          <div class="wa-stack wa-gap-s">
            <p class="section-label">Invite Link</p>
            <wa-radio-group
              .value=${this._linkRole}
              @change=${this._onLinkRoleChange}
            >
              <wa-radio appearance="button" value="viewer">Viewer</wa-radio>
              <wa-radio appearance="button" value="editor">Editor</wa-radio>
            </wa-radio-group>

            <wa-button
              variant="brand"
              size="small"
              ?loading=${this._generating}
              @click=${this._onGenerateLink}
            >
              <wa-icon slot="start" name="link" library="fa-jelly"></wa-icon>
              Generate Link
            </wa-button>

            ${this._generatedUrl ? html`
              <div class="link-box wa-cluster wa-align-items-center wa-gap-xs">
                <span>${this._generatedUrl}</span>
                <wa-copy-button
                  value=${this._generatedUrl}
                  copy-label="Copy link"
                  success-label="Copied!"
                  feedback-duration="2000"
                >
                  <wa-icon slot="copy-icon" name="clone" library="fa-jelly"></wa-icon>
                </wa-copy-button>
              </div>
            ` : nothing}
          </div>

          <wa-divider></wa-divider>

          <!-- Collaborators list -->
          <div class="wa-stack wa-gap-s">
            <p class="section-label">Collaborators</p>

            ${this._loading
              ? html`<div class="wa-cluster wa-justify-content-center"><wa-spinner></wa-spinner></div>`
              : this._shares.length === 0
                ? html`<div class="empty-collab">No collaborators yet.</div>`
                : this._shares.map(share => this._renderShare(share))}
          </div>
        </div>

        <wa-button slot="footer" appearance="outlined" variant="neutral" @click=${this._onClose}>Close</wa-button>
      </wa-dialog>

      <wa-dialog ?open=${this._pendingRemoveId !== null} @wa-after-hide=${() => { this._pendingRemoveId = null; }}>
        <span slot="label">Remove Collaborator?</span>
        <p>They will need a new invite link to regain access.</p>
        <wa-button slot="footer" variant="danger" @click=${this._confirmRemove}>Remove</wa-button>
        <wa-button slot="footer" appearance="outlined" variant="neutral" @click=${() => { this._pendingRemoveId = null; }}>Cancel</wa-button>
      </wa-dialog>
    `;
  }

  private _renderShare(share: ShareData) {
    const claimUrl = share.claim_token
      ? `${window.location.origin}/claim/${share.claim_token}`
      : null;

    if (!share.claimed) {
      return html`
        <div class="collab-row wa-cluster wa-align-items-center wa-gap-s">
          <wa-icon name="user" library="fa-jelly" class="collab-icon-pending"></wa-icon>
          <div class="collaborator-info">
            <div class="pending-label">Pending invite</div>
            ${claimUrl ? html`<div class="collaborator-email claim-url">${claimUrl}</div>` : nothing}
          </div>
          <wa-badge variant=${share.role === 'editor' ? 'brand' : 'neutral'}>${share.role}</wa-badge>
          ${claimUrl ? html`
            <wa-copy-button
              value=${claimUrl}
              copy-label="Copy invite link"
              success-label="Copied!"
              feedback-duration="2000"
            >
              <wa-icon slot="copy-icon" name="clone"></wa-icon>
            </wa-copy-button>
          ` : nothing}
          <wa-tooltip content="Remove">
            <wa-button appearance="plain" size="small" label="Remove" @click=${() => this._onRemoveShare(share.id)}>
              <wa-icon name="trash"></wa-icon>
            </wa-button>
          </wa-tooltip>
        </div>
      `;
    }

    return html`
      <div class="collab-row wa-cluster wa-align-items-center wa-gap-s">
        <wa-icon name="user" library="fa-jelly" class="collab-icon-claimed"></wa-icon>
        <div class="collaborator-info">
          <div class="collaborator-name">${share.user_name ?? 'Unknown'}</div>
          ${share.user_email ? html`<div class="collaborator-email">${share.user_email}</div>` : nothing}
        </div>
        <wa-select
          size="small"
          .value=${share.role}
          @change=${(e: Event) => this._onRoleChange(share.id, (e.target as HTMLElement & { value: string }).value as 'viewer' | 'editor')}
          class="role-select"
        >
          <wa-option value="viewer">Viewer</wa-option>
          <wa-option value="editor">Editor</wa-option>
        </wa-select>
        <wa-tooltip content="Remove">
          <wa-button appearance="plain" size="small" label="Remove" @click=${() => this._onRemoveShare(share.id)}>
            <wa-icon name="trash"></wa-icon>
          </wa-button>
        </wa-tooltip>
      </div>
    `;
  }

  private async _onVisibilityToggle(e: Event) {
    const isPublic = (e.target as HTMLElement & { checked: boolean }).checked;
    const newVisibility = isPublic ? 'public' : 'private';
    try {
      await updateVisibility(this.mapId, newVisibility);
      this.visibility = newVisibility;
      this.dispatchEvent(new CustomEvent('visibility-changed', {
        detail: { visibility: newVisibility },
        bubbles: true,
        composed: true,
      }));
    } catch {
      this._error = 'Failed to update visibility. Please try again.';
    }
  }

  private _onLinkRoleChange(e: Event) {
    this._linkRole = (e.target as HTMLElement & { value: string }).value as 'viewer' | 'editor';
  }

  private async _onGenerateLink() {
    this._generating = true;
    try {
      const result = await generateShareLink(this.mapId, this._linkRole);
      this._generatedUrl = result.url || `${window.location.origin}/claim/${result.claim_token}`;
      // Refresh shares list
      this._shares = await getMapShares(this.mapId);
    } catch {
      this._error = 'Failed to generate invite link. Please try again.';
    } finally {
      this._generating = false;
    }
  }

  private async _onRoleChange(shareId: string, role: 'viewer' | 'editor') {
    try {
      await updateShare(this.mapId, shareId, role);
      this._shares = this._shares.map(s => s.id === shareId ? { ...s, role } : s);
    } catch {
      this._error = 'Failed to update collaborator role. Please try again.';
      // Revert on failure
      this._shares = await getMapShares(this.mapId);
    }
  }

  private _onRemoveShare(shareId: string) {
    this._pendingRemoveId = shareId;
  }

  private async _confirmRemove() {
    const shareId = this._pendingRemoveId;
    this._pendingRemoveId = null;
    if (!shareId) return;

    try {
      await deleteShare(this.mapId, shareId);
      this._shares = this._shares.filter(s => s.id !== shareId);
    } catch {
      this._error = 'Failed to remove collaborator. Please try again.';
    }
  }

  private _onClose() {
    this._open = false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'share-dialog': ShareDialog;
  }
}
