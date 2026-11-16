import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

describe('README 的金鑰路徑', () => {
  it('寫成 %APPDATA%/agent-sprite-forge/config.json（路徑分隔符不能被吃掉，變成 %APPDATA%agent-sprite-forgeconfig.json）', () => {
    expect(readme).toContain('%APPDATA%/agent-sprite-forge/config.json');
    expect(readme).not.toContain('%APPDATA%agent-sprite-forgeconfig.json');
  });
});
