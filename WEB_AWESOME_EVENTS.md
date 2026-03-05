# Web Awesome Pro — Component Event Reference

This reference covers the event naming conventions and specific events emitted by Web Awesome Pro components.

---

## Event Naming Convention

Web Awesome uses a **split naming convention**:

- **Custom/component-specific events** are prefixed with `wa-` (e.g., `wa-clear`, `wa-show`, `wa-after-hide`). These are custom `Event` classes where the prefixed name is hardcoded.
- **Standard DOM events** use native unprefixed names (e.g., `change`, `input`, `focus`, `blur`). These are typically dispatched as native `Event` or `InputEvent` objects.

**Note:** Components do not use an `emit()` helper; they call `this.dispatchEvent()` directly. Always check the component documentation or definition to confirm if a specific interaction uses a native or `wa-` prefixed event.

---

## Component Event Reference

### wa-combobox
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `input` | No | No | Fires on selection (Enter, click), clear, backspace remove (multi), form reset. |
| `change` | No | No | Fires alongside `input` on committed value changes. |
| `wa-clear` | Yes | No | Clear button clicked. |
| `wa-show` | Yes | Yes | Popup about to open. |
| `wa-after-show` | Yes | No | Popup fully open, animation complete. |
| `wa-hide` | Yes | Yes | Popup about to close. |
| `wa-after-hide` | Yes | No | Popup fully closed, animation complete. |
| `wa-invalid` | Yes | No | Form validation failed. |
| `focus` | No | No | Internal input focused. |
| `blur` | No | No | Internal input blurred. |

> **Note on `input`:** The component may call `stopPropagation()` on native typing events. To listen for typing, use a capture-phase listener: `addEventListener('input', ..., true)`.

### wa-dialog
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `wa-show` | Yes | Yes | Dialog about to open; `preventDefault()` cancels. |
| `wa-after-show` | Yes | No | Dialog fully open, animation complete. |
| `wa-hide` | Yes | Yes | Dialog about to close; `preventDefault()` cancels. `event.detail.source` identifies trigger. |
| `wa-after-hide` | Yes | No | Dialog fully closed, scroll unlocked, focus returned. |

### wa-input
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `input` | No | No | User types in the input (native `InputEvent`). |
| `change` | No | No | Value committed (blur after edit, or clear button). |
| `wa-clear` | Yes | No | Clear button clicked. |
| `wa-invalid` | Yes | No | Form validation failed. |
| `focus` | No | No | Input focused (delegatesFocus). |
| `blur` | No | No | Input blurred (delegatesFocus). |

### wa-select
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `input` | No | No | Fires on selection change. |
| `change` | No | No | Fires alongside `input` on committed selection. |
| `wa-clear` | Yes | No | Clear button clicked. |
| `wa-show` | Yes | Yes | Dropdown about to open. |
| `wa-after-show` | Yes | No | Dropdown fully open. |
| `wa-hide` | Yes | Yes | Dropdown about to close. |
| `wa-after-hide` | Yes | No | Dropdown fully closed. |
| `wa-invalid` | Yes | No | Form validation failed. |
| `focus` | No | No | Internal input focused. |
| `blur` | No | No | Internal input blurred. |

### wa-switch
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `input` | No | No | Fires on toggle. |
| `change` | No | No | Fires on toggle (alongside `input`). |
| `wa-invalid` | Yes | No | Form validation failed. |
| `focus` | No | No | Internal checkbox focused. |
| `blur` | No | No | Internal checkbox blurred. |

### wa-radio-group
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `input` | No | No | Fires on radio selection change. |
| `change` | No | No | Fires on radio selection change (alongside `input`). |
| `wa-invalid` | Yes | No | Form validation failed. |

### wa-details
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `wa-show` | Yes | Yes | Details about to open; `preventDefault()` cancels. |
| `wa-after-show` | Yes | No | Details fully open, animation complete. |
| `wa-hide` | Yes | Yes | Details about to close; `preventDefault()` cancels. |
| `wa-after-hide` | Yes | No | Details fully closed, animation complete. |

### wa-dropdown
| Event | Prefixed | Cancelable | Description |
|-------|----------|------------|-------------|
| `wa-show` | Yes | Yes | Dropdown about to open. |
| `wa-after-show` | Yes | No | Dropdown fully open. |
| `wa-hide` | Yes | Yes | Dropdown about to close. `event.detail.source` identifies trigger. |
| `wa-after-hide` | Yes | No | Dropdown fully closed. |
| `wa-select` | Yes | Yes | Item selected. `event.detail.item` references the selected `<wa-dropdown-item>`. |

---

## Elements with Minimal or No Custom Events

These components typically emit standard DOM events (like `click`) or only the following specific custom events:

| Element | Custom Events |
|---------|---------------|
| `wa-avatar` | `wa-error` |
| `wa-badge` | None |
| `wa-button` | `wa-invalid`, `focus`, `blur` |
| `wa-callout` | None |
| `wa-card` | None |
| `wa-divider` | None |
| `wa-dropdown-item` | None |
| `wa-icon` | `wa-load`, `wa-error` |
| `wa-option` | None |
| `wa-page` | None |
| `wa-radio` | None (handled by parent `wa-radio-group`) |
| `wa-relative-time` | None |
| `wa-spinner` | None |
| `wa-tooltip` | `wa-show`, `wa-after-show`, `wa-hide`, `wa-after-hide` |
