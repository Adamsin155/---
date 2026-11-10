// "מעקב לקוחות", the tab "משימות לעורכים ולגרפיקאי". A placeholder: the real tab is built on the
// branch feat/tracking-tasks and replaces this file when the two are merged.
import { fill, h } from './protocol-ui.js';

export async function renderTasksTab(host) {
  fill(host, [h('p', { class: 'sh-soon' }, 'בקרוב: המשימות של העורכים והגרפיקאי.')]);
}
