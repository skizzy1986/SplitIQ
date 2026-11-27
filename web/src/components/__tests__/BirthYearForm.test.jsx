import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import BirthYearForm from '../BirthYearForm.jsx';

const field = () => screen.getByRole('textbox', { name: 'Year of birth' });

describe('BirthYearForm', () => {
  // Storage half of H 13. The typed max-HR alternative and "neither means no
  // bands" belong to S5 (MaxHrForm.test.jsx).
  it('H13: year of birth saves and removes; it is used only for the estimate', async () => {
    const onSave = vi.fn().mockResolvedValue();
    const onRemove = vi.fn().mockResolvedValue();
    const { rerender } = render(
      <BirthYearForm birthYear={null} onSave={onSave} onRemove={onRemove} />
    );
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(
      screen.getByText(/used only to estimate your maximum heart rate/i)
    ).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: '1985' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(1985));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();

    rerender(
      <BirthYearForm birthYear={1985} onSave={onSave} onRemove={onRemove} />
    );
    expect(field()).toHaveValue('1985');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Removed.')).toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('refuses a bad year, or one under 18, without saving', () => {
    const onSave = vi.fn();
    render(<BirthYearForm onSave={onSave} onRemove={vi.fn()} />);
    fireEvent.change(field(), { target: { value: '85' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Enter a four-digit year'
    );
    fireEvent.change(field(), {
      target: { value: String(new Date().getFullYear() - 5) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('status')).toHaveTextContent('18 or over');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says so when a save fails, and never shows the year in the message', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom 1985'));
    render(<BirthYearForm onSave={onSave} onRemove={vi.fn()} />);
    fireEvent.change(field(), { target: { value: '1985' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Could not save that. Try again.');
    expect(status.textContent).not.toContain('1985');
  });
});
