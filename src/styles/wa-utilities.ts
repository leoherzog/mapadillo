import { unsafeCSS } from 'lit';
import layoutCSS from '@web.awesome.me/webawesome-pro/dist/styles/utilities/layout.css?inline';
import gapCSS from '@web.awesome.me/webawesome-pro/dist/styles/utilities/gap.css?inline';
import alignCSS from '@web.awesome.me/webawesome-pro/dist/styles/utilities/align-items.css?inline';
import justifyCSS from '@web.awesome.me/webawesome-pro/dist/styles/utilities/justify-content.css?inline';

export const waUtilities = unsafeCSS(`${layoutCSS}\n${gapCSS}\n${alignCSS}\n${justifyCSS}`);
