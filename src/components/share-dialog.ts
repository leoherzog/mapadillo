/**
 * Share dialog — allows map owners to manage visibility, invite collaborators,
 * and view/remove existing shares.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { ShareData, ShareRole, Visibility } from '../services/maps.js';
import {
  getMapShares,
  generateShareLink,
  updateShare,
  deleteShare,
  updateVisibility,
} from '../services/maps.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { errorCallout, roleBadge } from './ui.js';
import { fieldChecked, fieldValue } from '../utils/form.js';

/** Absolute invite URL for a claim token. */
const claimUrl = (token: string) => `${location.origin}/claim/${token}`;

@customElement('share-dialog')
export class ShareDialog extends LitElement {
  @property() mapId = '';
  @property() visibility: Visibility = 'private';

  @state() private _shares: ShareData[] = [];
  @state() private _loading = false;
  @state() private _linkRole: ShareRole = 'viewer';
  @state() private _generatedUrl = '';
  @state() private _generating = false;
  private _revokingShareId: string | null = null;
  @state() private _dialogMode: 'share' | 'confirm-revoke' | null = null;
  @state() private _error = '';

  static styles = [waUtilities, css`
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
    this._dialogMode = 'share';
    try {
      this._shares = await getMapShares(this.mapId);
    } catch {
      this._shares = [];
      this._error = 'Could not load collaborators. Please try again.';
    } finally {
      this._loading = false;
    }
  }

  render() {
    const isConfirm = this._dialogMode === 'confirm-revoke';
    const isOpen = this._dialogMode !== null;
    return html`
      <wa-dialog ?open=${isOpen} @wa-after-hide=${this._onAfterHide}>
        <span slot="label">
          ${isConfirm
            ? html`Remove Collaborator?`
            : html`<wa-icon name="share-nodes" class="label-icon"></wa-icon> Share Trip`}
        </span>

        ${isConfirm
          ? html`
              <p>They will need a new invite link to regain access.</p>
            `
          : html`
              <div class="wa-stack wa-gap-l">
                ${this._error ? errorCallout(this._error) : nothing}

                <!-- Visibility toggle -->
                <div class="wa-stack wa-gap-xs">
                  <p class="section-label">Visibility</p>
                  <wa-switch
                    .checked=${live(this.visibility === 'public')}
                    hint=${this.visibility === 'public'
                      ? 'Anyone with the link can view this trip.'
                      : 'Only invited collaborators can access this trip.'}
                    @change=${this._onVisibilityToggle}
                  >Public</wa-switch>
                </div>

                <wa-divider></wa-divider>

                <!-- Generate invite link -->
                <div class="wa-stack wa-gap-s">
                  <p class="section-label">Invite Link</p>
                  <wa-radio-group
                    label="Invite role"
                    .value=${this._linkRole}
                    @change=${this._onLinkRoleChange}
                  >
                    <wa-radio appearance="button" value="viewer">Viewer</wa-radio>
                    <wa-radio appearance="button" value="editor">Editor</wa-radio>
                  </wa-radio-group>

                  <wa-button
                    id="generate-link"
                    variant="brand"
                    size="s"
                    ?loading=${this._generating}
                    @click=${this._onGenerateLink}
                  >
                    <wa-icon slot="start" name="link"></wa-icon>
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
                        <wa-icon slot="copy-icon" name="clone"></wa-icon>
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
            `}

        ${isConfirm
          ? html`
              <wa-button slot="footer" variant="danger" @click=${this._confirmRemove}>Remove</wa-button>
              <wa-button id="revoke-cancel" slot="footer" appearance="outlined" variant="neutral" @click=${this._cancelRevoke}>Cancel</wa-button>
            `
          : html`
              <wa-button slot="footer" appearance="outlined" variant="neutral" @click=${this._onClose}>Close</wa-button>
            `}
      </wa-dialog>
    `;
  }

  private _renderShare(share: ShareData) {
    const inviteUrl = share.claim_token ? claimUrl(share.claim_token) : null;

    if (!share.claimed) {
      return html`
        <div class="collab-row wa-cluster wa-align-items-center wa-gap-s">
          <wa-icon name="user" class="collab-icon-pending"></wa-icon>
          <div class="collaborator-info">
            <div class="pending-label">Pending invite</div>
            ${inviteUrl ? html`<div class="collaborator-email claim-url">${inviteUrl}</div>` : nothing}
          </div>
          ${roleBadge(share.role)}
          ${inviteUrl ? html`
            <wa-copy-button
              value=${inviteUrl}
              copy-label="Copy invite link"
              success-label="Copied!"
              feedback-duration="2000"
            >
              <wa-icon slot="copy-icon" name="clone"></wa-icon>
            </wa-copy-button>
          ` : nothing}
          <wa-button id="remove-${share.id}" appearance="plain" size="s" @click=${() => this._onRemoveShare(share.id)}>
            <wa-icon name="trash" label="Remove collaborator"></wa-icon>
          </wa-button>
          <wa-tooltip for="remove-${share.id}">Remove</wa-tooltip>
        </div>
      `;
    }

    return html`
      <div class="collab-row wa-cluster wa-align-items-center wa-gap-s">
        <wa-icon name="user" class="collab-icon-claimed"></wa-icon>
        <div class="collaborator-info">
          <div class="collaborator-name">${share.user_name ?? 'Unknown'}</div>
          ${share.user_email ? html`<div class="collaborator-email">${share.user_email}</div>` : nothing}
        </div>
        <wa-select
          label="Role"
          size="s"
          .value=${live(share.role)}
          @change=${(e: Event) => this._onRoleChange(share, fieldValue(e) as ShareRole)}
          class="role-select"
        >
          <wa-option value="viewer">Viewer</wa-option>
          <wa-option value="editor">Editor</wa-option>
        </wa-select>
        <wa-button id="remove-claimed-${share.id}" appearance="plain" size="s" @click=${() => this._onRemoveShare(share.id)}>
          <wa-icon name="trash" label="Remove collaborator"></wa-icon>
        </wa-button>
        <wa-tooltip for="remove-claimed-${share.id}">Remove</wa-tooltip>
      </div>
    `;
  }

  private async _onVisibilityToggle(e: Event) {
    const previous = this.visibility;
    const next: Visibility = fieldChecked(e) ? 'public' : 'private';
    this._error = '';
    this.visibility = next;
    try {
      await updateVisibility(this.mapId, next);
      this.dispatchEvent(new CustomEvent('visibility-changed', {
        detail: { visibility: next },
        bubbles: true,
        composed: true,
      }));
    } catch {
      this.visibility = previous;
      this._error = 'Failed to update visibility. Please try again.';
    }
  }

  private _onLinkRoleChange(e: Event) {
    this._linkRole = fieldValue(e) as ShareRole;
  }

  private async _onGenerateLink() {
    this._error = '';
    this._generating = true;
    try {
      const result = await generateShareLink(this.mapId, this._linkRole);
      this._generatedUrl = claimUrl(result.claim_token);
      this._shares = await getMapShares(this.mapId).catch(() => this._shares);
    } catch {
      this._error = 'Failed to generate invite link. Please try again.';
    } finally {
      this._generating = false;
    }
  }

  private async _onRoleChange(share: ShareData, role: ShareRole) {
    const setRole = (r: ShareRole) => {
      this._shares = this._shares.map(s => (s.id === share.id ? { ...s, role: r } : s));
    };
    this._error = '';
    setRole(role);
    try {
      await updateShare(this.mapId, share.id, role);
    } catch {
      setRole(share.role);
      this._error = 'Failed to update collaborator role. Please try again.';
    }
  }

  private _onRemoveShare(shareId: string) {
    this._revokingShareId = shareId;
    this._dialogMode = 'confirm-revoke';
    void this._focusAfterRender('revoke-cancel');
  }

  private _cancelRevoke() {
    this._revokingShareId = null;
    this._dialogMode = 'share';
    void this._focusAfterRender('generate-link');
  }

  private async _confirmRemove() {
    const shareId = this._revokingShareId;
    this._revokingShareId = null;
    this._dialogMode = 'share';
    void this._focusAfterRender('generate-link');
    if (!shareId) return;
    this._error = '';

    try {
      await deleteShare(this.mapId, shareId);
      this._shares = this._shares.filter(s => s.id !== shareId);
    } catch {
      this._error = 'Failed to remove collaborator. Please try again.';
    }
  }

  private _onClose() {
    this._dialogMode = null;
    this._revokingShareId = null;
  }

  /** Syncs state when the dialog itself closes (Esc, header X); nested tooltips and selects also bubble wa-after-hide. */
  private _onAfterHide(e: Event) {
    if (e.target !== e.currentTarget) return;
    this._dialogMode = null;
    this._revokingShareId = null;
  }

  /** Focuses an element in this dialog after the pending render. */
  private async _focusAfterRender(id: string) {
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`#${id}`)?.focus();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'share-dialog': ShareDialog;
  }
}
