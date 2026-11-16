import { render } from '@testing-library/react';
import Icon from '../Icon.jsx';

describe('Icon', () => {
  it.each(['today', 'train', 'progress', 'body', 'settings'])(
    'draws an svg for %s',
    (name) => {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).not.toBeNull();
    }
  );
});
