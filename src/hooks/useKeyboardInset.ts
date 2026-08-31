import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Soft-Keyboard-Höhe. Android edge-to-edge overlayt die Tastatur oft
 * statt das Fenster zu verkleinern — dann muss das Layout selbst Platz machen.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const apply = (h: number) => {
      const n = Math.max(0, h);
      setInset(n > 48 ? n : 0);
    };
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      apply(e.endCoordinates.height),
    );
    const will = Keyboard.addListener('keyboardWillShow', (e) =>
      apply(e.endCoordinates.height),
    );
    const frame = Keyboard.addListener('keyboardDidChangeFrame', (e) => {
      const h = e.endCoordinates.height;
      if (h > 80) apply(h);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setInset(0));
    const willHide = Keyboard.addListener('keyboardWillHide', () =>
      setInset(0),
    );
    return () => {
      show.remove();
      will.remove();
      frame.remove();
      hide.remove();
      willHide.remove();
    };
  }, []);

  return inset;
}
