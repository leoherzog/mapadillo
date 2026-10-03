/**
 * Typed readers for Web Awesome form-control events, used by the input, select,
 * radio-group, combobox, switch and checkbox handlers across pages and components.
 */
import type WaCheckbox from '@web.awesome.me/webawesome-pro/dist/components/checkbox/checkbox.js';
import type WaCombobox from '@web.awesome.me/webawesome-pro/dist/components/combobox/combobox.js';
import type WaInput from '@web.awesome.me/webawesome-pro/dist/components/input/input.js';
import type WaRadioGroup from '@web.awesome.me/webawesome-pro/dist/components/radio-group/radio-group.js';
import type WaSelect from '@web.awesome.me/webawesome-pro/dist/components/select/select.js';
import type WaSwitch from '@web.awesome.me/webawesome-pro/dist/components/switch/switch.js';

type ValueControl = WaInput | WaSelect | WaRadioGroup | WaCombobox;
type CheckedControl = WaCheckbox | WaSwitch;

/**
 * The value of the control the listener is attached to; empty reads as ''.
 * Single-value controls only: a multi-select's array is not supported.
 * @param e an event from a Web Awesome value control, read during dispatch
 */
export function fieldValue(e: Event): string {
  const { value } = e.currentTarget as ValueControl;
  return value == null ? '' : String(value);
}

/**
 * The checked state of the switch or checkbox the listener is attached to.
 * @param e an event from a Web Awesome checkable control, read during dispatch
 */
export function fieldChecked(e: Event): boolean {
  return (e.currentTarget as CheckedControl).checked;
}
