import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import TrainingPathChoice from '../TrainingPathChoice.jsx';

const STRAP = 'I have a strap or arm band';
const NONE = "I don't have one";

describe('TrainingPathChoice', () => {
  it('H6: two choices, no brand or link; a watch takes the no-strap path', () => {
    const onChoose = vi.fn();
    const { container } = render(<TrainingPathChoice onChoose={onChoose} />);
    expect(screen.getByRole('button', { name: STRAP })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: NONE })).toBeInTheDocument();
    // Two choices, and no way to leave the screen to a shop or a site.
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelector('a, img, iframe')).toBeNull();
    const text = container.textContent;
    expect(text).not.toMatch(
      /garmin|polar|wahoo|concept2|apple|fitbit|coros|suunto|whoop|amazon|buy|shop|purchase|\$/i
    );
    // A wrist watch does not count; the text says what a watch-only user picks.
    expect(text).toMatch(/wrist watch does not count/i);
    expect(text).toMatch(/all you have, choose the second option/i);
    fireEvent.click(screen.getByRole('button', { name: NONE }));
    expect(onChoose).toHaveBeenCalledWith('rpe');
    fireEvent.click(screen.getByRole('button', { name: STRAP }));
    expect(onChoose).toHaveBeenLastCalledWith('strap');
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it('H7: nothing preselected; skip stores rpe', () => {
    const onChoose = vi.fn();
    const onSkip = vi.fn();
    render(<TrainingPathChoice onChoose={onChoose} onSkip={onSkip} />);
    for (const name of [STRAP, NONE]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    }
    // Rendering applies no default: nothing is chosen until the user acts.
    expect(onChoose).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Skip, and go by effort' })
    );
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('marks the stored path, and hides Skip when the caller gives none', () => {
    render(<TrainingPathChoice value="strap" onChoose={vi.fn()} />);
    expect(screen.getByRole('button', { name: STRAP })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: NONE })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  });

  it('disables every button while a save is in flight', () => {
    render(<TrainingPathChoice onChoose={vi.fn()} onSkip={vi.fn()} disabled />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});
