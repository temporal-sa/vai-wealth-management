import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          flags: [{ flag: 'tool_down', label: 'Core banking API down', description: 'Tools fail.', enabled: false }],
          events: [],
        }),
    }),
  );
});

test('renders the chat', () => {
  render(<App />);
  expect(screen.getByText(/Wealth Management Chatbot/i)).toBeInTheDocument();
  expect(screen.getByText('Start Chat')).toBeInTheDocument();
});

test('the chaos button toggles the chaos panel', async () => {
  render(<App />);
  expect(screen.queryByText('Chaos panel')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Chaos'));
  expect(screen.getByText('Chaos panel')).toBeInTheDocument();
  expect(await screen.findByText('Core banking API down')).toBeInTheDocument();

  fireEvent.click(screen.getByText('Hide chaos'));
  expect(screen.queryByText('Chaos panel')).not.toBeInTheDocument();
});
