import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAROUSEL_INTERVAL_MS, carouselMode, createCarousel } from '../../src/lib/carousel';

describe('carouselMode', () => {
  it('uses hover on devices that can hover', () => {
    expect(carouselMode({ slideCount: 3, canHover: true, reducedMotion: false })).toBe('hover');
  });

  it('uses viewport visibility on touch devices', () => {
    expect(carouselMode({ slideCount: 3, canHover: false, reducedMotion: false })).toBe('viewport');
  });

  it('never auto-plays with 0 or 1 slide', () => {
    expect(carouselMode({ slideCount: 0, canHover: true, reducedMotion: false })).toBe('none');
    expect(carouselMode({ slideCount: 1, canHover: false, reducedMotion: false })).toBe('none');
  });

  it('never auto-plays under reduced motion', () => {
    expect(carouselMode({ slideCount: 5, canHover: true, reducedMotion: true })).toBe('none');
    expect(carouselMode({ slideCount: 5, canHover: false, reducedMotion: true })).toBe('none');
  });
});

describe('createCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances every 3 seconds after start and wraps around', () => {
    expect(CAROUSEL_INTERVAL_MS).toBe(3000);
    const onChange = vi.fn();
    const carousel = createCarousel({ slideCount: 3, onChange });

    carousel.start();
    expect(carousel.index()).toBe(0);
    vi.advanceTimersByTime(2999);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(carousel.index()).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(carousel.index()).toBe(2);
    vi.advanceTimersByTime(3000);
    expect(carousel.index()).toBe(0);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([1, 2, 0]);
  });

  it('does nothing before start', () => {
    const onChange = vi.fn();
    createCarousel({ slideCount: 3, onChange });
    vi.advanceTimersByTime(10_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops and returns to the first slide', () => {
    const onChange = vi.fn();
    const carousel = createCarousel({ slideCount: 4, onChange });
    carousel.start();
    vi.advanceTimersByTime(6000);
    expect(carousel.index()).toBe(2);

    carousel.stop();
    expect(carousel.index()).toBe(0);
    expect(carousel.isRunning()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(0);

    onChange.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not notify on stop when already at the first slide', () => {
    const onChange = vi.fn();
    const carousel = createCarousel({ slideCount: 3, onChange });
    carousel.start();
    carousel.stop();
    carousel.stop();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not double the speed when started twice', () => {
    const carousel = createCarousel({ slideCount: 5, onChange: () => {} });
    carousel.start();
    carousel.start();
    vi.advanceTimersByTime(3000);
    expect(carousel.index()).toBe(1);
  });

  it('restarts a full interval after a stop', () => {
    const carousel = createCarousel({ slideCount: 3, onChange: () => {} });
    carousel.start();
    vi.advanceTimersByTime(2000);
    carousel.stop();
    carousel.start();
    vi.advanceTimersByTime(2000);
    expect(carousel.index()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(carousel.index()).toBe(1);
  });

  it.each([0, 1])('never runs with %i slide(s)', (slideCount) => {
    const onChange = vi.fn();
    const carousel = createCarousel({ slideCount, onChange });
    carousel.start();
    expect(carousel.isRunning()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(onChange).not.toHaveBeenCalled();
    expect(carousel.index()).toBe(0);
  });

  it('accepts a custom interval', () => {
    const carousel = createCarousel({ slideCount: 2, intervalMs: 500, onChange: () => {} });
    carousel.start();
    vi.advanceTimersByTime(500);
    expect(carousel.index()).toBe(1);
  });
});
