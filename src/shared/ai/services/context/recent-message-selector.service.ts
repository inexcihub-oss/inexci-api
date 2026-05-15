import { Injectable } from '@nestjs/common';

export interface RecentMessageCandidate {
  role: string;
  content: string;
  toolName?: string | null;
}

@Injectable()
export class RecentMessageSelectorService {
  select(
    candidates: RecentMessageCandidate[],
    limit: number,
    activeRefs: string[] = [],
  ): Array<{ role: string; content: string }> {
    if (!candidates.length) return [];

    const normalizedRefs = activeRefs
      .map((ref) => ref.trim().toLowerCase())
      .filter(Boolean);

    const scored = candidates.map((candidate, index) => {
      let score = 0;
      if (index === candidates.length - 1 && candidate.role === 'user')
        score += 100;
      if (candidate.role === 'tool') score += 50;
      if (candidate.toolName) score += 20;
      if (
        normalizedRefs.length &&
        normalizedRefs.some((ref) =>
          candidate.content.toLowerCase().includes(ref),
        )
      ) {
        score += 30;
      }
      score += index / 1000;
      return { candidate, score, index };
    });

    return scored
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .sort((left, right) => left.index - right.index)
      .map(({ candidate }) => ({
        role: candidate.role,
        content: candidate.content,
      }));
  }
}
