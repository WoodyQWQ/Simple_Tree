import { useEffect, useMemo, useState } from "react";
import type { AiSuggestion, AssociationCandidate, NodeId, TreeNode } from "../../domain/types";
import {
  associationCandidates,
  requestAssociationSuggestions,
} from "../../domain/association";
import { useTreeStore } from "../../store/treeStore";

interface SuggestionsState {
  suggestions: AiSuggestion[];
  loading: boolean;
  error: string | null;
}

export function useAssociationSuggestions(item: string) {
  const aiSettings = useTreeStore((state) => state.aiSettings);
  const nodes = useTreeStore((state) => state.nodes);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<SuggestionsState>({
    suggestions: [],
    loading: false,
    error: null,
  });

  const nodeMap = useMemo(
    () => new Map<NodeId, TreeNode>(Object.values(nodes ?? {}).map((node) => [node.id, node])),
    [nodes],
  );

  const candidates: AssociationCandidate[] = useMemo(
    () => associationCandidates(nodeMap, item),
    [nodeMap, item],
  );

  const enabled = Boolean(
    aiSettings.enabled && aiSettings.apiKey.trim() && aiSettings.baseUrl.trim() && aiSettings.model.trim(),
  );

  useEffect(() => {
    const trimmed = item.trim();
    if (!enabled || trimmed.length < 2 || candidates.length === 0) {
      setState({ suggestions: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    let timedOut = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ suggestions: [], loading: true, error: null });
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 8000);
      try {
        const suggestions = await requestAssociationSuggestions(
          aiSettings,
          trimmed,
          candidates,
          nodeMap,
          controller.signal,
        );
        if (cancelled) return;
        setState({ suggestions, loading: false, error: null });
      } catch {
        if (cancelled) return;
        setState({
          suggestions: [],
          loading: false,
          error: timedOut ? "AI 推荐超时，可手动选择" : "AI 推荐不可用，可手动选择",
        });
      } finally {
        window.clearTimeout(timeout);
      }
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [item, enabled, nonce, aiSettings, candidates, nodeMap]);

  return {
    ...state,
    candidates,
    enabled,
    retry: () => setNonce((value) => value + 1),
  };
}
