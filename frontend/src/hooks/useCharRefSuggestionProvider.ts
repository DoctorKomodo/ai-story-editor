import { useEffect, useRef } from 'react';
import { type CharRefSuggestionItem, setCharRefSuggestionProvider } from '@/lib/charRefSuggestion';

export function useCharRefSuggestionProvider(getCharacters: () => CharRefSuggestionItem[]): void {
  const ref = useRef(getCharacters);
  useEffect(() => {
    ref.current = getCharacters;
  }, [getCharacters]);

  useEffect(() => {
    setCharRefSuggestionProvider(() => ref.current());
    return () => {
      setCharRefSuggestionProvider(null);
    };
  }, []);
}
