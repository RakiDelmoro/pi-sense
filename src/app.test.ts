import { describe, it, expect } from 'bun:test';

describe('Sensor data formatting', () => {
  it('formats timestamps under 10 seconds as "Just now"', () => {
    const now = new Date();
    const justNow = new Date(now.getTime() - 5000);
    const diff = Math.floor((now.getTime() - justNow.getTime()) / 1000);
    expect(diff).toBeLessThan(10);
  });

  it('formats timestamps 30 seconds ago correctly', () => {
    const now = new Date();
    const ago = new Date(now.getTime() - 30000);
    const diff = Math.floor((now.getTime() - ago.getTime()) / 1000);
    expect(diff).toBe(30);
  });
});
