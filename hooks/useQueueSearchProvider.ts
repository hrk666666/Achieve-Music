import { useMemo } from "react";
import { Song } from "../types";
import { SearchProvider } from "./useSearchProvider";

interface UseQueueSearchProviderParams {
  queue: Song[];
}

export const useQueueSearchProvider = ({
  queue,
}: UseQueueSearchProviderParams): SearchProvider => {
  const provider: SearchProvider = useMemo(
    () => ({
      id: "queue",
      label: "Current Queue",
      requiresExplicitSearch: false,
      isLoading: false,
      hasMore: false,

      search: async (query: string): Promise<Song[]> => {
        // Real-time filtering - no need for explicit search
        if (!query.trim()) {
          return queue;
        }

        const lower = query.toLowerCase();
        return queue.filter(
          (s) =>
            s.title.toLowerCase().includes(lower) ||
            s.artist.toLowerCase().includes(lower)
        );
      },
    }),
    [queue]
  );

  return provider;
};
