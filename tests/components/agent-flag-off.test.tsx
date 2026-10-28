// @vitest-environment happy-dom
// With FEATURES.agent off, nothing points at the connector.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';

vi.mock('../../src/config', () => ({ FEATURES: { agent: false }, REPO_URL: 'https://github.com/derintolu/learn-wp-reimagined' }));

import { CapNotice } from '../../src/components/CapNotice';

describe('agent feature off', () => {
  it('CapNotice hides "Continue in your own AI" but keeps the message', () => {
    const { container } = render(<CapNotice status={{ ai: 'capped', reason: 'day-cap' }} />);
    expect(screen.queryByRole('link', { name: 'Continue in your own AI' })).toBeNull();
    expect((container.textContent ?? '').length).toBeGreaterThan(20);
  });
});
