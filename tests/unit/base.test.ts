import { describe, expect, it } from 'vitest';
import { joinBase, normalizeBase } from '../../src/lib/base';
import { resolveDeployTarget } from '../../deploy-target.mjs';

describe('normalizeBase', () => {
  it.each([
    ['/liu_yi', '/liu_yi/'],
    ['/liu_yi/', '/liu_yi/'],
    ['liu_yi', '/liu_yi/'],
    ['/', '/'],
    ['', '/'],
    [undefined, '/'],
    ['//a//b//', '/a/b/'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeBase(input)).toBe(expected);
  });
});

describe('joinBase', () => {
  it('prefixes a sub-path base', () => {
    expect(joinBase('/liu_yi', '/courses/')).toBe('/liu_yi/courses/');
    expect(joinBase('/liu_yi/', 'courses/bajiquan/')).toBe('/liu_yi/courses/bajiquan/');
  });

  it('works at root base', () => {
    expect(joinBase('/', '/courses/')).toBe('/courses/');
    expect(joinBase('', 'courses/')).toBe('/courses/');
  });

  it('maps the site root to the base itself', () => {
    expect(joinBase('/liu_yi', '/')).toBe('/liu_yi/');
    expect(joinBase('/liu_yi', '')).toBe('/liu_yi/');
    expect(joinBase('/', '/')).toBe('/');
  });

  it('keeps query and hash', () => {
    expect(joinBase('/liu_yi', '/courses/?a=1#top')).toBe('/liu_yi/courses/?a=1#top');
  });

  it('never produces double slashes', () => {
    expect(joinBase('/liu_yi/', '/courses//x/')).toBe('/liu_yi/courses/x/');
  });

  it('leaves external and in-page targets alone', () => {
    for (const href of [
      'https://www.facebook.com/x',
      'http://example.com',
      '//cdn.example.com/a.js',
      'mailto:a@example.com',
      'tel:+886',
      '#line',
    ]) {
      expect(joinBase('/liu_yi', href)).toBe(href);
    }
  });
});

describe('resolveDeployTarget', () => {
  it('defaults to the GitHub Pages project URL', () => {
    expect(resolveDeployTarget({})).toEqual({
      site: 'https://lawa0921.github.io',
      base: '/liu_yi',
      outDir: './dist',
    });
  });

  it('can be overridden to the root path', () => {
    expect(
      resolveDeployTarget({ SITE_URL: 'https://example.com/', BASE_PATH: '/', OUT_DIR: 'dist-root' }),
    ).toEqual({ site: 'https://example.com', base: '/', outDir: './dist-root' });
  });

  it('normalises a base without slashes and ignores blank values', () => {
    expect(resolveDeployTarget({ BASE_PATH: 'preview/' }).base).toBe('/preview');
    expect(resolveDeployTarget({ BASE_PATH: '  ', SITE_URL: '' })).toEqual({
      site: 'https://lawa0921.github.io',
      base: '/liu_yi',
      outDir: './dist',
    });
  });
});
