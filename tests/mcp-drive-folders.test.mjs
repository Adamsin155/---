// The owners' drive_folders tool of the mcp function (11.11.2026): the subfolders of one Drive folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDERS_TOOL } from '../supabase/functions/mcp/handler.js';

test('drive_folders is described for the owners with one folder input', () => {
  assert.equal(FOLDERS_TOOL.name, 'drive_folders');
  assert.deepEqual(FOLDERS_TOOL.inputSchema.required, ['folder']);
  assert.match(FOLDERS_TOOL.description, /owners only/);
});
