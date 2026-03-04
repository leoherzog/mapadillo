import { unsafeCSS } from 'lit';
import layoutCSS from '@awesome.me/webawesome-pro/dist/styles/utilities/layout.css?inline';
import gapCSS from '@awesome.me/webawesome-pro/dist/styles/utilities/gap.css?inline';
import alignCSS from '@awesome.me/webawesome-pro/dist/styles/utilities/align-items.css?inline';
import justifyCSS from '@awesome.me/webawesome-pro/dist/styles/utilities/justify-content.css?inline';
import borderRadiusCSS from '@awesome.me/webawesome-pro/dist/styles/utilities/border-radius.css?inline';

export const waUtilities = unsafeCSS(`${layoutCSS}\n${gapCSS}\n${alignCSS}\n${justifyCSS}\n${borderRadiusCSS}`);
